import fs from "fs";
import path from "path";
import type { IEventBus } from "../../src/BasicBehaveEngine/IBehaveEngine";
import { createThreeLoader, ThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";
import { registerGLTFInteractivity } from "../../src/integrations/GLTFInteractivityPlugin";
import { getInteractivityRuntime } from "../../src/integrations/InteractivityRuntime";
import { localResourceDataUrl } from "./localAssetUrl";

export async function loadThreeWorldFromGlb(glbPath: string, eventBus?: IEventBus): Promise<ThreeLoadedModel> {
    return loadThreeWorldFromGltf(glbPath, eventBus);
}

export async function loadThreeWorldFromGltf(assetPath: string, eventBus?: IEventBus): Promise<ThreeLoadedModel> {
    installWebGlobalsForNode();
    const absolutePath = path.resolve(assetPath);
    const loader = createThreeLoader();
    loader.manager.setURLModifier((url) => localResourceDataUrl(url, path.dirname(absolutePath)) ?? url);
    registerGLTFInteractivity(loader, { autoStart: false, eventBus });
    const source = fs.readFileSync(absolutePath);
    const data = path.extname(absolutePath).toLowerCase() === ".gltf"
        ? source.toString("utf8")
        : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    const gltf = await loader.parseAsync(data, `${path.dirname(absolutePath)}/`);
    const runtime = getInteractivityRuntime(gltf);
    if (!runtime) throw new Error(`GLTFInteractivityPlugin did not initialize ${assetPath}`);
    return runtime.model;
}

function installWebGlobalsForNode(): void {
    if (typeof self === "undefined") {
        Object.defineProperty(globalThis, "self", { configurable: true, value: globalThis });
    }

    if (typeof globalThis.ProgressEvent !== "undefined") {
        return;
    }
    class NodeProgressEvent extends Event {
        readonly lengthComputable: boolean;
        readonly loaded: number;
        readonly total: number;

        constructor(type: string, init: ProgressEventInit = {}) {
            super(type);
            this.lengthComputable = init.lengthComputable ?? false;
            this.loaded = init.loaded ?? 0;
            this.total = init.total ?? 0;
        }
    }
    Object.defineProperty(globalThis, "ProgressEvent", { configurable: true, value: NodeProgressEvent });
}
