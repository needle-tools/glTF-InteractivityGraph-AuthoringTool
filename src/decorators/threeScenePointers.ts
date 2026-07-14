import {
    Camera,
    Light,
    MathUtils,
    Mesh,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    PointLight,
    Quaternion,
    SpotLight,
    Vector3,
} from "three";
import type { ThreeLoadedModel } from "../integrations/ThreeLoadedModel";
import type { ThreePointerBinder } from "./threePointerTypes";

export function registerThreeScenePointers(model: ThreeLoadedModel, bind: ThreePointerBinder): void {
    registerNodePointers(model, bind);
    registerMeshWeightPointers(model, bind);
    registerCameraPointers(model, bind);
    registerLightPointers(model, bind);
}

function registerNodePointers(model: ThreeLoadedModel, bind: ThreePointerBinder): void {
    model.nodes.forEach((node, nodeIndex) => {
        if (!node) return;
        const source = model.gltf.nodes?.[nodeIndex];
        if (!source) return;

        bind(`/nodes/${nodeIndex}/translation`, "float3", () => node.position.toArray(), (value) => {
            node.position.fromArray(asArray(value));
            node.updateMatrix();
        });
        if (source.matrix === undefined) {
            bind(`/nodes/${nodeIndex}/rotation`, "float4", () => node.quaternion.toArray(), (value) => {
                node.quaternion.fromArray(asArray(value));
                node.updateMatrix();
            });
            bind(`/nodes/${nodeIndex}/scale`, "float3", () => node.scale.toArray(), (value) => {
                node.scale.fromArray(asArray(value));
                node.updateMatrix();
            });
        }
        bind(`/nodes/${nodeIndex}/matrix`, "float4x4", () => {
            node.updateMatrix();
            return node.matrix.toArray();
        }, undefined, true);
        bind(`/nodes/${nodeIndex}/globalMatrix`, "float4x4", () => {
            node.updateWorldMatrix(true, false);
            return node.matrixWorld.toArray();
        }, undefined, true);

        if (source.mesh !== undefined) {
            const morphMeshes = findMorphMeshes(node);
            const targetCount = model.meshWeights[source.mesh]?.length ?? 0;
            bind(`/nodes/${nodeIndex}/weights.length`, "int", () => [targetCount], undefined, true);
            const weights = morphMeshes[0]?.morphTargetInfluences;
            if (weights && targetCount > 0) {
                bind(`/nodes/${nodeIndex}/weights`, "float[]", () => [...weights], (value) => {
                    const next = asArray(value);
                    morphMeshes.forEach((mesh) => mesh.morphTargetInfluences?.splice(0, targetCount, ...next));
                });
                for (let weightIndex = 0; weightIndex < targetCount; weightIndex++) {
                    bind(`/nodes/${nodeIndex}/weights/${weightIndex}`, "float", () => [weights[weightIndex]], (value) => {
                        const next = scalar(value);
                        morphMeshes.forEach((mesh) => {
                            if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[weightIndex] = next;
                        });
                    });
                }
            }
        }

        if (source.extensions?.KHR_node_visibility) {
            bind(`/nodes/${nodeIndex}/extensions/KHR_node_visibility/visible`, "bool", () => [node.visible], (value) => node.visible = Boolean(scalar(value)));
        }
        if (source.extensions?.KHR_node_selectability) {
            bind(`/nodes/${nodeIndex}/extensions/KHR_node_selectability/selectable`, "bool", () => [node.userData.selectable !== false], (value) => node.userData.selectable = Boolean(scalar(value)));
        }
        if (source.extensions?.KHR_node_hoverability) {
            bind(`/nodes/${nodeIndex}/extensions/KHR_node_hoverability/hoverable`, "bool", () => [node.userData.hoverable !== false], (value) => node.userData.hoverable = Boolean(scalar(value)));
        }
    });
}

export function registerThreeActiveCameraPointers(camera: Camera, register: ThreePointerBinder): void {
    const worldPosition = new Vector3();
    const worldRotation = new Quaternion();
    register("/extensions/KHR_interactivity/activeCamera/position", "float3", () => camera.getWorldPosition(worldPosition).toArray(), undefined, true);
    register("/extensions/KHR_interactivity/activeCamera/rotation", "float4", () => camera.getWorldQuaternion(worldRotation).toArray(), undefined, true);

    register("/extensions/KHR_interactivity/activeCamera/perspective/aspectRatio", "float", () => [isPerspectiveCamera(camera) ? camera.aspect : NaN], undefined, true);
    register("/extensions/KHR_interactivity/activeCamera/perspective/yfov", "float", () => [isPerspectiveCamera(camera) ? MathUtils.degToRad(camera.fov) : NaN], undefined, true);
    register("/extensions/KHR_interactivity/activeCamera/perspective/znear", "float", () => [isPerspectiveCamera(camera) ? camera.near : NaN], undefined, true);
    register("/extensions/KHR_interactivity/activeCamera/perspective/zfar", "float", () => [isPerspectiveCamera(camera) ? camera.far : NaN], undefined, true);

    register("/extensions/KHR_interactivity/activeCamera/orthographic/xmag", "float", () => [isOrthographicCamera(camera) ? (camera.right - camera.left) / 2 : NaN], undefined, true);
    register("/extensions/KHR_interactivity/activeCamera/orthographic/ymag", "float", () => [isOrthographicCamera(camera) ? (camera.top - camera.bottom) / 2 : NaN], undefined, true);
    register("/extensions/KHR_interactivity/activeCamera/orthographic/znear", "float", () => [isOrthographicCamera(camera) ? camera.near : NaN], undefined, true);
    register("/extensions/KHR_interactivity/activeCamera/orthographic/zfar", "float", () => [isOrthographicCamera(camera) ? camera.far : NaN], undefined, true);
}

function registerMeshWeightPointers(model: ThreeLoadedModel, bind: ThreePointerBinder): void {
    model.meshInstances.forEach((roots, meshIndex) => {
        const defaultWeightRoots = roots.filter((root) => model.gltf.nodes?.[root.userData.gltfNodeIndex]?.weights === undefined);
        const meshes = defaultWeightRoots.flatMap(findMorphMeshes);
        const weights = model.meshWeights[meshIndex];
        if (!weights) {
            return;
        }
        weights.forEach((_weight, weightIndex) => {
            bind(`/meshes/${meshIndex}/weights/${weightIndex}`, "float", () => [weights[weightIndex]], (value) => {
                const next = scalar(value);
                weights[weightIndex] = next;
                meshes.forEach((mesh) => {
                    if (mesh.morphTargetInfluences) {
                        mesh.morphTargetInfluences[weightIndex] = next;
                    }
                });
            });
        });
    });
}

function registerCameraPointers(model: ThreeLoadedModel, bind: ThreePointerBinder): void {
    model.cameraInstances.forEach((instances, cameraIndex) => {
        const source = model.gltf.cameras?.[cameraIndex];
        const perspective = instances.filter(isPerspectiveCamera);
        if (perspective.length > 0) {
            if (source?.perspective?.aspectRatio !== undefined) bindCameraScalar<PerspectiveCamera>(bind, `/cameras/${cameraIndex}/perspective/aspectRatio`, perspective, (camera) => camera.aspect, (camera, value) => camera.aspect = value);
            if (source?.perspective?.yfov !== undefined) bindCameraScalar<PerspectiveCamera>(bind, `/cameras/${cameraIndex}/perspective/yfov`, perspective, (camera) => MathUtils.degToRad(camera.fov), (camera, value) => camera.fov = MathUtils.radToDeg(value));
            if (source?.perspective?.znear !== undefined) bindCameraScalar<PerspectiveCamera>(bind, `/cameras/${cameraIndex}/perspective/znear`, perspective, (camera) => camera.near, (camera, value) => camera.near = value);
            if (source?.perspective?.zfar !== undefined) bindCameraScalar<PerspectiveCamera>(bind, `/cameras/${cameraIndex}/perspective/zfar`, perspective, (camera) => camera.far, (camera, value) => camera.far = value);
        }

        const orthographic = instances.filter(isOrthographicCamera);
        if (orthographic.length > 0) {
            if (source?.orthographic?.xmag !== undefined) bindCameraScalar<OrthographicCamera>(bind, `/cameras/${cameraIndex}/orthographic/xmag`, orthographic, (camera) => (camera.right - camera.left) / 2, (camera, value) => {
                camera.left = -value;
                camera.right = value;
            });
            if (source?.orthographic?.ymag !== undefined) bindCameraScalar<OrthographicCamera>(bind, `/cameras/${cameraIndex}/orthographic/ymag`, orthographic, (camera) => (camera.top - camera.bottom) / 2, (camera, value) => {
                camera.bottom = -value;
                camera.top = value;
            });
            if (source?.orthographic?.znear !== undefined) bindCameraScalar<OrthographicCamera>(bind, `/cameras/${cameraIndex}/orthographic/znear`, orthographic, (camera) => camera.near, (camera, value) => camera.near = value);
            if (source?.orthographic?.zfar !== undefined) bindCameraScalar<OrthographicCamera>(bind, `/cameras/${cameraIndex}/orthographic/zfar`, orthographic, (camera) => camera.far, (camera, value) => camera.far = value);
        }
    });
}

function registerLightPointers(model: ThreeLoadedModel, bind: ThreePointerBinder): void {
    model.lightInstances.forEach((instances, lightIndex) => {
        const source = model.gltf.extensions?.KHR_lights_punctual?.lights?.[lightIndex];
        let color = [...(source?.color ?? [1, 1, 1])];
        let intensity = source?.intensity ?? 1;
        bind(`/extensions/KHR_lights_punctual/lights/${lightIndex}/color`, "float3", () => instances[0]?.color.toArray() ?? [...color], (value) => {
            color = asArray(value);
            instances.forEach((light) => light.color.setRGB(color[0], color[1], color[2]));
        });
        bind(`/extensions/KHR_lights_punctual/lights/${lightIndex}/intensity`, "float", () => [instances[0]?.intensity ?? intensity], (value) => {
            intensity = scalar(value);
            instances.forEach((light) => light.intensity = intensity);
        });

        const ranged = instances.filter((light): light is PointLight | SpotLight => isPointLight(light) || isSpotLight(light));
        let range = source?.range ?? Infinity;
        bind(`/extensions/KHR_lights_punctual/lights/${lightIndex}/range`, "float", () => [range], (value) => {
            range = scalar(value);
            ranged.forEach((light) => light.distance = Number.isFinite(range) ? range : 0);
        });

        const spots = instances.filter(isSpotLight);
        if (source?.type === "spot") {
            let inner = source.spot?.innerConeAngle ?? 0;
            let outer = source.spot?.outerConeAngle ?? Math.PI / 4;
            bind(`/extensions/KHR_lights_punctual/lights/${lightIndex}/spot/innerConeAngle`, "float", () => [spots[0] ? innerConeAngle(spots[0]) : inner], (value) => {
                inner = scalar(value);
                spots.forEach((light) => light.penumbra = light.angle === 0 ? 0 : 1 - inner / light.angle);
            });
            bind(`/extensions/KHR_lights_punctual/lights/${lightIndex}/spot/outerConeAngle`, "float", () => [spots[0]?.angle ?? outer], (value) => {
                outer = scalar(value);
                spots.forEach((light) => {
                    const inner = innerConeAngle(light);
                    light.angle = outer;
                    light.penumbra = outer === 0 ? 0 : 1 - inner / outer;
                });
            });
        }
    });
}

function bindCameraScalar<T extends PerspectiveCamera | OrthographicCamera>(
    bind: ThreePointerBinder,
    path: string,
    cameras: T[],
    get: (camera: T) => number,
    set: (camera: T, value: number) => void,
): void {
    bind(path, "float", () => [get(cameras[0])], (value) => {
        cameras.forEach((camera) => {
            set(camera, scalar(value));
            camera.updateProjectionMatrix();
        });
    });
}

function innerConeAngle(light: SpotLight): number {
    return light.angle * (1 - light.penumbra);
}

function findMorphMeshes(root: Object3D): Mesh[] {
    const result: Mesh[] = [];
    const visit = (object: Object3D): void => {
        if (object !== root && Number.isInteger(object.userData.gltfNodeIndex)) {
            return;
        }
        if ((object as Mesh).isMesh && (object as Mesh).morphTargetInfluences) result.push(object as Mesh);
        object.children.forEach(visit);
    };
    visit(root);
    return result;
}

function asArray(value: unknown): number[] {
    return Array.isArray(value) ? value.map(Number) : [Number(value)];
}

function scalar(value: unknown): number {
    return Number(Array.isArray(value) ? value[0] : value);
}

function isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
    return Boolean((camera as PerspectiveCamera).isPerspectiveCamera);
}

function isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
    return Boolean((camera as OrthographicCamera).isOrthographicCamera);
}

function isPointLight(light: Light): light is PointLight {
    return Boolean((light as PointLight).isPointLight);
}

function isSpotLight(light: Light): light is SpotLight {
    return Boolean((light as SpotLight).isSpotLight);
}
