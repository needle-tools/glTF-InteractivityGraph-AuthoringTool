import fs from "fs";
import path from "path";
import type { IEventBus } from "../../src/BasicBehaveEngine/IBehaveEngine";
import { createThreeLoader, ThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";
import { registerGLTFInteractivity } from "../../src/integrations/GLTFInteractivityPlugin";
import { getInteractivityRuntime } from "../../src/integrations/InteractivityRuntime";

export async function loadThreeWorldFromGlb(glbPath: string, eventBus?: IEventBus): Promise<ThreeLoadedModel> {
    installWebGlobalsForNode();
    const bytes = fs.readFileSync(path.resolve(glbPath));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const loader = createThreeLoader();
    registerGLTFInteractivity(loader, { autoStart: false, eventBus });
    const gltf = await loader.parseAsync(data, `${path.dirname(path.resolve(glbPath))}/`);
    const runtime = getInteractivityRuntime(gltf);
    if (!runtime) throw new Error(`GLTFInteractivityPlugin did not initialize ${glbPath}`);
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
