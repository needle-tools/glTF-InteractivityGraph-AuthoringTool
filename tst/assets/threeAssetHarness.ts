import fs from "fs";
import path from "path";
import { loadThreeModelFromArrayBuffer, ThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";

export async function loadThreeWorldFromGlb(glbPath: string): Promise<ThreeLoadedModel> {
    installWebGlobalsForNode();
    const bytes = fs.readFileSync(path.resolve(glbPath));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return loadThreeModelFromArrayBuffer(data, `${path.dirname(path.resolve(glbPath))}/`);
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
