import type { WebGLRenderer } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
export {
    buildThreeLoadedModel,
    disposeThreeLoadedModel,
    type GlTfDocument,
    type ThreeLoadedModel,
} from "../../integrations/ThreeLoadedModel";

const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/v1/decoders/";
const KTX2_TRANSCODER_PATH = "https://www.gstatic.com/basis-universal/latest/";

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
