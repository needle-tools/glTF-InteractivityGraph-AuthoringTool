import {
    AnimationClip,
    AnimationMixer,
    BufferGeometry,
    Group,
    Material,
    Mesh,
    Object3D,
    Texture,
    WebGLRenderer,
} from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { IInteractivityGraph } from "../../BasicBehaveEngine/types/InteractivityGraph";

const DRACO_DECODER_PATH = "https://www.gstatic.com/draco/v1/decoders/";
const KTX2_TRANSCODER_PATH = "https://www.gstatic.com/basis-universal/latest/";

interface GlTfDocument {
    nodes?: Array<{
        mesh?: number;
        weights?: number[];
        extensions?: {
            KHR_node_visibility?: { visible?: boolean };
            KHR_node_selectability?: { selectable?: boolean };
            KHR_node_hoverability?: { hoverable?: boolean };
        };
    }>;
    meshes?: Array<{ weights?: number[] }>;
    materials?: unknown[];
    extensions?: {
        KHR_interactivity?: { graph?: number; graphs?: IInteractivityGraph[] };
        [extension: string]: unknown;
    };
    extensionsUsed?: string[];
    extensionsRequired?: string[];
}

export interface ThreeLoadedModel {
    scene: Group;
    gltf: GlTfDocument;
    nodes: Array<Object3D | undefined>;
    animations: AnimationClip[];
    materials: Array<Material | undefined>;
    materialInstances: Material[][];
    meshes: Mesh[];
    mixer: AnimationMixer;
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

export async function loadThreeModelFromUrl(url: string, loader = createThreeLoader()): Promise<ThreeLoadedModel> {
    return buildThreeLoadedModel(await loader.loadAsync(url));
}

export async function loadThreeModelFromArrayBuffer(
    data: ArrayBuffer,
    resourcePath = "",
    loader = createThreeLoader(),
): Promise<ThreeLoadedModel> {
    return buildThreeLoadedModel(await loader.parseAsync(data, resourcePath));
}

export function buildThreeLoadedModel(result: GLTF): ThreeLoadedModel {
    const gltf = result.parser.json as GlTfDocument;
    const nodes: Array<Object3D | undefined> = new Array(gltf.nodes?.length ?? 0);
    const materials: Array<Material | undefined> = new Array(gltf.materials?.length ?? 0);
    const materialInstances: Material[][] = Array.from({ length: materials.length }, () => []);
    const meshes: Mesh[] = [];

    result.parser.associations.forEach((reference, target) => {
        if (!reference) {
            return;
        }
        if (target instanceof Object3D && reference.nodes !== undefined) {
            target.userData.gltfNodeIndex = reference.nodes;
            nodes[reference.nodes] ??= target;
        }
        if (target instanceof Material && reference.materials !== undefined) {
            materials[reference.materials] ??= target;
            materialInstances[reference.materials].push(target);
        }
    });

    result.scene.traverse((object) => {
        if (object instanceof Mesh) {
            meshes.push(object);
        }
    });

    nodes.forEach((node, nodeIndex) => {
        const nodeDefinition = gltf.nodes?.[nodeIndex];
        if (!node || !nodeDefinition) {
            return;
        }
        node.visible = nodeDefinition.extensions?.KHR_node_visibility?.visible ?? true;
        node.userData.selectable = nodeDefinition.extensions?.KHR_node_selectability?.selectable ?? true;
        node.userData.hoverable = nodeDefinition.extensions?.KHR_node_hoverability?.hoverable ?? true;
        if (nodeDefinition.mesh === undefined) {
            return;
        }
        const meshDefinition = gltf.meshes?.[nodeDefinition.mesh];
        const initialWeights = nodeDefinition.weights ?? meshDefinition?.weights;
        if (!initialWeights) {
            return;
        }
        node.traverse((object) => {
            if (object instanceof Mesh && object.morphTargetInfluences) {
                object.morphTargetInfluences.splice(0, initialWeights.length, ...initialWeights);
            }
        });
    });

    return {
        scene: result.scene,
        gltf,
        nodes,
        animations: result.animations,
        materials,
        materialInstances,
        meshes,
        mixer: new AnimationMixer(result.scene),
    };
}

export function disposeThreeLoadedModel(model: ThreeLoadedModel): void {
    model.mixer.stopAllAction();
    const disposedMaterials = new Set<Material>();
    const disposedTextures = new Set<Texture>();
    const disposedGeometries = new Set<BufferGeometry>();

    model.scene.traverse((object) => {
        if (!(object instanceof Mesh)) {
            return;
        }
        if (!disposedGeometries.has(object.geometry)) {
            disposedGeometries.add(object.geometry);
            object.geometry.dispose();
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (disposedMaterials.has(material)) {
                continue;
            }
            disposedMaterials.add(material);
            for (const value of Object.values(material)) {
                if (value instanceof Texture && !disposedTextures.has(value)) {
                    disposedTextures.add(value);
                    value.dispose();
                }
            }
            material.dispose();
        }
    });
}
