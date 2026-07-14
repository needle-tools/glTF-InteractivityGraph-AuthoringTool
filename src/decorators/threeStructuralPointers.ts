import type { ThreeLoadedModel } from "../components/engineViews/threeLoadedModel";
import type { ThreePointerBinder } from "./threePointerTypes";

export function registerThreeStructuralPointers(model: ThreeLoadedModel, bind: ThreePointerBinder): void {
    const gltf = model.gltf;
    bindCount(bind, "/animations.length", gltf.animations?.length ?? 0);
    bindCount(bind, "/cameras.length", gltf.cameras?.length ?? 0);
    bindCount(bind, "/materials.length", gltf.materials?.length ?? 0);
    bindCount(bind, "/meshes.length", gltf.meshes?.length ?? 0);
    bindCount(bind, "/nodes.length", gltf.nodes?.length ?? 0);
    bindCount(bind, "/scenes.length", gltf.scenes?.length ?? 0);
    bindCount(bind, "/skins.length", gltf.skins?.length ?? 0);
    bindCount(bind, "/extensions/KHR_lights_punctual/lights.length", gltf.extensions?.KHR_lights_punctual?.lights?.length ?? 0);
    bind("/scene", "int", () => [gltf.scene ?? 0], undefined, true);

    gltf.scenes?.forEach((scene, sceneIndex) => {
        const nodes = scene.nodes ?? [];
        bindCount(bind, `/scenes/${sceneIndex}/nodes.length`, nodes.length);
        nodes.forEach((nodeIndex, childIndex) => bindRef(bind, `/scenes/${sceneIndex}/nodes/${childIndex}`, "nodes", nodeIndex));
    });

    const parents = buildParentIndices(gltf.nodes ?? []);
    gltf.nodes?.forEach((node, nodeIndex) => {
        const children = node.children ?? [];
        bindCount(bind, `/nodes/${nodeIndex}/children.length`, children.length);
        children.forEach((childNodeIndex, childIndex) => bindRef(bind, `/nodes/${nodeIndex}/children/${childIndex}`, "nodes", childNodeIndex));
        const parentIndex = parents[nodeIndex];
        if (parentIndex !== undefined) bindRef(bind, `/nodes/${nodeIndex}/parent`, "nodes", parentIndex);
        if (node.mesh !== undefined) bindRef(bind, `/nodes/${nodeIndex}/mesh`, "meshes", node.mesh);
        if (node.camera !== undefined) bindRef(bind, `/nodes/${nodeIndex}/camera`, "cameras", node.camera);
        if (node.skin !== undefined) bindRef(bind, `/nodes/${nodeIndex}/skin`, "skins", node.skin);
        const light = node.extensions?.KHR_lights_punctual?.light;
        if (light !== undefined) bindRef(bind, `/nodes/${nodeIndex}/extensions/KHR_lights_punctual/light`, "extensions/KHR_lights_punctual/lights", light);
    });

    gltf.meshes?.forEach((mesh, meshIndex) => {
        const primitives = mesh.primitives ?? [];
        bindCount(bind, `/meshes/${meshIndex}/primitives.length`, primitives.length);
        bindCount(bind, `/meshes/${meshIndex}/weights.length`, model.meshWeights[meshIndex]?.length ?? 0);
        primitives.forEach((primitive, primitiveIndex) => {
            if (primitive.material !== undefined) {
                bindRef(bind, `/meshes/${meshIndex}/primitives/${primitiveIndex}/material`, "materials", primitive.material);
            }
        });
    });

    gltf.skins?.forEach((skin, skinIndex) => {
        const joints = skin.joints ?? [];
        bindCount(bind, `/skins/${skinIndex}/joints.length`, joints.length);
        joints.forEach((nodeIndex, jointIndex) => bindRef(bind, `/skins/${skinIndex}/joints/${jointIndex}`, "nodes", nodeIndex));
        if (skin.skeleton !== undefined) bindRef(bind, `/skins/${skinIndex}/skeleton`, "nodes", skin.skeleton);
    });

    model.animations.forEach((_animation, animationIndex) => {
        const path = `/animations/${animationIndex}/`;
        bind(path, "ref", () => [path], undefined, true);
    });
}

function bindCount(bind: ThreePointerBinder, path: string, count: number): void {
    bind(path, "int", () => [count], undefined, true);
}

function bindRef(bind: ThreePointerBinder, path: string, collection: string, index: number): void {
    bind(path, "ref", () => [`/${collection}/${index}`], undefined, true);
}

function buildParentIndices(nodes: NonNullable<ThreeLoadedModel["gltf"]["nodes"]>): Array<number | undefined> {
    const parents: Array<number | undefined> = new Array(nodes.length);
    nodes.forEach((node, parentIndex) => node.children?.forEach((childIndex) => parents[childIndex] = parentIndex));
    return parents;
}
