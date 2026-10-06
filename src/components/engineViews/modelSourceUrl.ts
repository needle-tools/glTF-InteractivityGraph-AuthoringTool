import { useCallback, useEffect, useRef } from "react";
import { packageAsGlb } from "../../objectModel/gltfPackaging";
import { ModelSource } from "./modelExport";
import { resolveModelResource } from "./modelFiles";

interface ModelSourceUrl {
    url: string;
    /** absent for a URL source, which owns nothing to release */
    revoke?: () => void;
}

/**
 * A URL the three.js-based viewers (Three, Needle) can load. A local .gltf is packed with its
 * selected .bin/texture files into one in-memory .glb (keeping its own graph), because those
 * loaders resolve relative uris against the model URL and a blob URL has no siblings.
 */
async function createModelSourceUrl(source: ModelSource): Promise<ModelSourceUrl> {
    if (source.kind === "url") {
        return { url: source.url };
    }
    const { model, entries } = source;
    let blob: Blob = model.file;
    if (/\.gltf$/i.test(model.path)) {
        const glb = await packageAsGlb(await model.file.arrayBuffer(), undefined, async (uri) => {
            const file = resolveModelResource(entries, model, uri);
            if (file === undefined) {
                throw new Error(`"${decodeURIComponent(uri)}" is referenced by ${model.file.name} but was not selected; select or drop it together with the model`);
            }
            return new Uint8Array(await file.arrayBuffer());
        });
        blob = new Blob([glb], { type: "model/gltf-binary" });
    }
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
}

// a failed load has no URL to revoke; its error was already reported by the caller
const revokeLater = (pending: Promise<ModelSourceUrl>) => void pending.then((resolved) => resolved.revoke?.(), () => undefined);

/**
 * Resolves model sources to loadable URLs. The last one is reused (Play reloads the same source
 * without packing it again); a replaced or unmounted one is revoked.
 */
export function useModelSourceUrl(): (source: ModelSource) => Promise<string> {
    const currentRef = useRef<{ source: ModelSource; pending: Promise<ModelSourceUrl> } | null>(null);

    useEffect(() => () => {
        if (currentRef.current) { revokeLater(currentRef.current.pending); }
        currentRef.current = null;
    }, []);

    return useCallback(async (source: ModelSource) => {
        const current = currentRef.current;
        if (current?.source !== source) {
            if (current) { revokeLater(current.pending); }
            currentRef.current = { source, pending: createModelSourceUrl(source) };
        }
        return (await currentRef.current!.pending).url;
    }, []);
}
