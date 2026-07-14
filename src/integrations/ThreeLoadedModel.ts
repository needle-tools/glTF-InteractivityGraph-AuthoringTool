import {
    AnimationClip,
    AnimationMixer,
    BufferGeometry,
    Camera,
    Group,
    Light,
    Material,
    Mesh,
    Object3D,
    Texture,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { IInteractivityGraph } from "../BasicBehaveEngine/types/InteractivityGraph";

export interface GlTfDocument {
    scene?: number;
    scenes?: Array<{ nodes?: number[] }>;
    nodes?: Array<{
        camera?: number;
        children?: number[];
        matrix?: number[];
        mesh?: number;
        skin?: number;
        weights?: number[];
        extensions?: {
            KHR_lights_punctual?: { light?: number };
            KHR_node_visibility?: { visible?: boolean };
            KHR_node_selectability?: { selectable?: boolean };
            KHR_node_hoverability?: { hoverable?: boolean };
        };
    }>;
    meshes?: Array<{
        weights?: number[];
        primitives?: Array<{ material?: number; targets?: unknown[] }>;
    }>;
    cameras?: Array<{
        perspective?: { aspectRatio?: number; yfov?: number; znear?: number; zfar?: number };
        orthographic?: { xmag?: number; ymag?: number; znear?: number; zfar?: number };
    }>;
    materials?: any[];
    skins?: Array<{ joints?: number[]; skeleton?: number }>;
    animations?: unknown[];
    extensions?: {
        KHR_interactivity?: { graph?: number; graphs?: IInteractivityGraph[] };
        KHR_lights_punctual?: { lights?: Array<{
            type?: string;
            color?: number[];
            intensity?: number;
            range?: number;
            spot?: { innerConeAngle?: number; outerConeAngle?: number };
        }> };
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
    meshInstances: Object3D[][];
    meshWeights: number[][];
    cameraInstances: Camera[][];
    lightInstances: Light[][];
    meshes: Mesh[];
    mixer: AnimationMixer;
}

export function buildThreeLoadedModel(
    result: GLTF,
    dependencyMaterials: Material[] = [],
    dependencyNodes: Object3D[] = [],
): ThreeLoadedModel {
    const gltf = result.parser.json as GlTfDocument;
    const nodes: Array<Object3D | undefined> = new Array(gltf.nodes?.length ?? 0);
    const materials: Array<Material | undefined> = new Array(gltf.materials?.length ?? 0);
    const materialInstances: Material[][] = Array.from({ length: materials.length }, () => []);
    const meshInstances: Object3D[][] = Array.from({ length: gltf.meshes?.length ?? 0 }, () => []);
    const meshWeights = (gltf.meshes ?? []).map((mesh) => {
        const targetCount = Math.max(0, ...(mesh.primitives ?? []).map((primitive) => primitive.targets?.length ?? 0));
        return Array.from({ length: targetCount }, (_, index) => mesh.weights?.[index] ?? 0);
    });
    const cameraInstances: Camera[][] = Array.from({ length: gltf.cameras?.length ?? 0 }, () => []);
    const lightInstances: Light[][] = Array.from({ length: gltf.extensions?.KHR_lights_punctual?.lights?.length ?? 0 }, () => []);
    const meshes: Mesh[] = [];

    result.cameras.forEach((camera, cameraIndex) => pushUnique(cameraInstances[cameraIndex], camera));
    dependencyMaterials.forEach((material, materialIndex) => {
        materials[materialIndex] = material;
        pushUnique(materialInstances[materialIndex], material);
    });

    result.scenes.forEach((scene, sceneIndex) => {
        const rootNodeIndices = gltf.scenes?.[sceneIndex]?.nodes ?? [];
        rootNodeIndices.forEach((nodeIndex, rootIndex) => {
            const root = scene.children[rootIndex];
            if (root) mapNodeHierarchy(gltf, nodes, nodeIndex, root);
        });
    });

    dependencyNodes.forEach((node, nodeIndex) => {
        nodes[nodeIndex] ??= node;
        node.userData.gltfNodeIndex = nodeIndex;
    });

    result.parser.associations.forEach((reference, target) => {
        if (!reference) {
            return;
        }
        if (isThreeMaterial(target) && reference.materials !== undefined) {
            materials[reference.materials] ??= target;
            pushUnique(materialInstances[reference.materials], target);
        }
    });

    result.scene.traverse((object) => {
        if (isThreeMesh(object)) {
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
        if (nodeDefinition.mesh !== undefined) {
            pushUnique(meshInstances[nodeDefinition.mesh], node);
            const meshDefinition = gltf.meshes?.[nodeDefinition.mesh];
            const initialWeights = nodeDefinition.weights ?? meshDefinition?.weights;
            if (initialWeights) {
                node.traverse((object) => {
                    if (isThreeMesh(object) && object.morphTargetInfluences) {
                        object.morphTargetInfluences.splice(0, initialWeights.length, ...initialWeights);
                    }
                });
            }
        }

        if (nodeDefinition.camera !== undefined) {
            collectInstances(node, isThreeCamera).forEach((camera) => pushUnique(cameraInstances[nodeDefinition.camera!], camera));
        }

        const lightIndex = nodeDefinition.extensions?.KHR_lights_punctual?.light;
        if (lightIndex !== undefined) {
            const lights: Light[] = [];
            node.traverse((object) => {
                if (isThreeLight(object)) lights.push(object);
            });
            lights.forEach((light) => pushUnique(lightInstances[lightIndex], light));
        }
    });

    return {
        scene: result.scene,
        gltf,
        nodes,
        animations: result.animations,
        materials,
        materialInstances,
        meshInstances,
        meshWeights,
        cameraInstances,
        lightInstances,
        meshes,
        mixer: new AnimationMixer(result.scene),
    };
}

function mapNodeHierarchy(
    gltf: GlTfDocument,
    nodes: Array<Object3D | undefined>,
    nodeIndex: number,
    object: Object3D,
): void {
    nodes[nodeIndex] ??= object;
    object.userData.gltfNodeIndex = nodeIndex;
    const childIndices = gltf.nodes?.[nodeIndex]?.children ?? [];
    const childObjects = childIndices.length === 0 ? [] : object.children.slice(-childIndices.length);
    childIndices.forEach((childIndex, index) => {
        const childObject = childObjects[index];
        if (childObject) mapNodeHierarchy(gltf, nodes, childIndex, childObject);
    });
}

function collectInstances<T extends Object3D>(root: Object3D, isType: (object: Object3D) => object is T): T[] {
    const instances: T[] = [];
    root.traverse((object) => {
        if (isType(object)) {
            instances.push(object);
        }
    });
    return instances;
}

function pushUnique<T>(values: T[], value: T): void {
    if (!values.includes(value)) {
        values.push(value);
    }
}

export function disposeThreeLoadedModel(model: ThreeLoadedModel): void {
    model.mixer.stopAllAction();
    const disposedMaterials = new Set<Material>();
    const disposedTextures = new Set<Texture>();
    const disposedGeometries = new Set<BufferGeometry>();

    const roots = [model.scene, ...model.nodes.filter((node): node is Object3D => node !== undefined)];
    roots.forEach((root) => {
        root.traverse((object) => {
            if (!isThreeMesh(object)) {
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
                    if (isThreeTexture(value) && !disposedTextures.has(value)) {
                        disposedTextures.add(value);
                        value.dispose();
                    }
                }
                material.dispose();
            }
        });
    });
}

function isThreeMaterial(value: unknown): value is Material {
    return Boolean((value as Material | undefined)?.isMaterial);
}

function isThreeTexture(value: unknown): value is Texture {
    return Boolean((value as Texture | undefined)?.isTexture);
}

function isThreeMesh(value: Object3D): value is Mesh {
    return Boolean((value as Mesh).isMesh);
}

function isThreeCamera(value: Object3D): value is Camera {
    return Boolean((value as Camera).isCamera);
}

function isThreeLight(value: Object3D): value is Light {
    return Boolean((value as Light).isLight);
}
