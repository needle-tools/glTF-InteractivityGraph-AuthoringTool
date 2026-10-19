import type { WebGLRenderer } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { IInteractivityGraph } from "../../BasicBehaveEngine/types/InteractivityGraph";
import { getDefaultInteractivityGraph } from "../../BasicBehaveEngine/validateInteractivity";
import type { GlTfDocument } from "../../integrations/ThreeLoadedModel";
export {
    buildThreeLoadedModel,
    disposeThreeLoadedModel,
    type GlTfDocument,
    type ThreeLoadedModel,
} from "../../integrations/ThreeLoadedModel";

const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/v1/decoders/";
const KTX2_TRANSCODER_PATH = "https://www.gstatic.com/basis-universal/latest/";

/** The default graph to run, or why the KHR_interactivity extension object is rejected (no graph runs). */
export function resolveEmbeddedGraph(gltf: GlTfDocument): { graph?: IInteractivityGraph; error?: string } {
    const extension = gltf.extensions?.KHR_interactivity;
    if (extension === undefined) return {};
    try {
        return { graph: getDefaultInteractivityGraph(extension) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

export function createThreeLoader(renderer?: WebGLRenderer): GLTFLoader {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    loader.setDRACOLoader(dracoLoader);

    if (renderer) {
        const ktx2Loader = new KTX2Loader();
        ktx2Loader.setTranscoderPath(KTX2_TRANSCODER_PATH);
        ktx2Loader.detectSupport(renderer);
        loader.setKTX2Loader(ktx2Loader);
    }
    return loader;
}
