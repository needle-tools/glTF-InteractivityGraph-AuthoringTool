import {
    AnimationAction,
    Camera,
    Intersection,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    Raycaster,
    Texture,
    Vector2,
} from "three";
import { IBehaveEngine } from "../BasicBehaveEngine/IBehaveEngine";
import { OnHoverIn } from "../BasicBehaveEngine/nodes/experimental/OnHoverIn";
import { OnHoverOut } from "../BasicBehaveEngine/nodes/experimental/OnHoverOut";
import { OnSelect } from "../BasicBehaveEngine/nodes/experimental/OnSelect";
import { createGlTFObjectModelFromGltf, GlTFObjectModelDecorator } from "../objectModel/glTFObjectModel";
import { ThreeLoadedModel } from "../components/engineViews/threeLoadedModel";

interface ActiveAnimation {
    action: AnimationAction;
    callback: () => void;
    endTime: number;
    speed: number;
    virtualTime: number;
}

type ThreePbrMaterial = MeshStandardMaterial & {
    clearcoat?: number;
    ior?: number;
    sheen?: number;
    sheenColor?: { r: number; g: number; b: number; setRGB(r: number, g: number, b: number): void };
    thickness?: number;
    transmission?: number;
};

type ThreeScalarMaterialProperty = "alphaTest" | "clearcoat" | "emissiveIntensity" | "ior" | "metalness" | "roughness" | "thickness" | "transmission";

export class ThreeDecorator extends GlTFObjectModelDecorator {
    private readonly model: ThreeLoadedModel;
    private readonly raycaster = new Raycaster();
    private readonly pointerNdc = new Vector2();
    private readonly threeAnimations = new Map<number, ActiveAnimation>();
    private camera: Camera | null = null;
    private domElement: HTMLElement | null = null;
    private animationTimer: ReturnType<typeof setInterval> | null = null;
    private lastAnimationTick = 0;

    constructor(behaveEngine: IBehaveEngine, model: ThreeLoadedModel) {
        super(behaveEngine, createGlTFObjectModelFromGltf(model.gltf));
        this.model = model;
        this.startAnimation = this.startThreeAnimation;
        this.stopAnimation = this.stopThreeAnimation;
        this.stopAnimationAt = this.stopThreeAnimationAt;
        this.bridgeEngineHooks();
        this.registerLivePointers();
        this.registerBehaveEngineNode("event/onSelect", OnSelect);
        this.registerBehaveEngineNode("event/onHoverIn", OnHoverIn);
        this.registerBehaveEngineNode("event/onHoverOut", OnHoverOut);
    }

    setCamera(camera: Camera): void {
        this.camera = camera;
        this.pointer("/extensions/KHR_interactivity/activeCamera/position", "float3", () => camera.position.toArray(), (value) => {
            camera.position.fromArray(asArray(value));
        });
        this.pointer("/extensions/KHR_interactivity/activeCamera/rotation", "float4", () => camera.quaternion.toArray(), (value) => {
            camera.quaternion.fromArray(asArray(value));
        });
    }

    attachPointerEvents(domElement: HTMLElement): void {
        this.detachPointerEvents();
        this.domElement = domElement;
        domElement.addEventListener("pointermove", this.handlePointerMove);
        domElement.addEventListener("pointerleave", this.handlePointerLeave);
        domElement.addEventListener("click", this.handleClick);
    }

    override dispose(): void {
        this.detachPointerEvents();
        this.stopAnimationTimer();
        this.model.mixer.stopAllAction();
        super.dispose();
    }

    private registerLivePointers(): void {
        this.model.nodes.forEach((node, nodeIndex) => {
            if (!node) {
                return;
            }
            this.bindIfValid(`/nodes/${nodeIndex}/translation`, "float3", () => node.position.toArray(), (value) => {
                node.position.fromArray(asArray(value));
                node.updateMatrix();
            });
            this.bindIfValid(`/nodes/${nodeIndex}/rotation`, "float4", () => node.quaternion.toArray(), (value) => {
                node.quaternion.fromArray(asArray(value));
                node.updateMatrix();
            });
            this.bindIfValid(`/nodes/${nodeIndex}/scale`, "float3", () => node.scale.toArray(), (value) => {
                node.scale.fromArray(asArray(value));
                node.updateMatrix();
            });
            this.bindIfValid(`/nodes/${nodeIndex}/matrix`, "float4x4", () => {
                node.updateMatrix();
                return node.matrix.toArray();
            }, undefined, true);
            this.bindIfValid(`/nodes/${nodeIndex}/globalMatrix`, "float4x4", () => {
                node.updateWorldMatrix(true, false);
                return node.matrixWorld.toArray();
            }, undefined, true);

            const morphMeshes = findMorphMeshes(node);
            const weights = morphMeshes[0]?.morphTargetInfluences;
            if (weights) {
                this.bindIfValid(`/nodes/${nodeIndex}/weights`, "float[]", () => [...weights], (value) => {
                    const next = asArray(value);
                    morphMeshes.forEach((mesh) => mesh.morphTargetInfluences?.splice(0, next.length, ...next));
                });
                weights.forEach((_weight, weightIndex) => {
                    this.bindIfValid(`/nodes/${nodeIndex}/weights/${weightIndex}`, "float", () => [weights[weightIndex]], (value) => {
                        const next = scalar(value);
                        morphMeshes.forEach((mesh) => {
                            if (mesh.morphTargetInfluences) {
                                mesh.morphTargetInfluences[weightIndex] = next;
                            }
                        });
                    });
                });
            }

            this.bindIfValid(`/nodes/${nodeIndex}/extensions/KHR_node_visibility/visible`, "bool", () => [node.visible], (value) => {
                node.visible = Boolean(scalar(value));
            });
            this.bindIfValid(`/nodes/${nodeIndex}/extensions/KHR_node_selectability/selectable`, "bool", () => [node.userData.selectable !== false], (value) => {
                node.userData.selectable = Boolean(scalar(value));
            });
            this.bindIfValid(`/nodes/${nodeIndex}/extensions/KHR_node_hoverability/hoverable`, "bool", () => [node.userData.hoverable !== false], (value) => {
                node.userData.hoverable = Boolean(scalar(value));
            });
        });

        this.model.materialInstances.forEach((materials, materialIndex) => {
            const pbrMaterials = materials.filter((material): material is ThreePbrMaterial => material instanceof MeshStandardMaterial);
            if (pbrMaterials.length === 0) {
                return;
            }
            const first = pbrMaterials[0];
            this.bindIfValid(`/materials/${materialIndex}/pbrMetallicRoughness/baseColorFactor`, "float4", () => [first.color.r, first.color.g, first.color.b, first.opacity], (value) => {
                const next = asArray(value);
                pbrMaterials.forEach((material) => {
                    material.color.setRGB(next[0], next[1], next[2]);
                    material.opacity = next[3];
                    material.transparent = next[3] < 1;
                    material.needsUpdate = true;
                });
            });
            this.bindMaterialScalar(materialIndex, pbrMaterials, "pbrMetallicRoughness/roughnessFactor", "roughness");
            this.bindMaterialScalar(materialIndex, pbrMaterials, "pbrMetallicRoughness/metallicFactor", "metalness");
            this.bindMaterialScalar(materialIndex, pbrMaterials, "alphaCutoff", "alphaTest");
            this.bindIfValid(`/materials/${materialIndex}/emissiveFactor`, "float3", () => first.emissive.toArray(), (value) => {
                const next = asArray(value);
                pbrMaterials.forEach((material) => material.emissive.setRGB(next[0], next[1], next[2]));
            });
            this.bindMaterialScalar(materialIndex, pbrMaterials, "extensions/KHR_materials_emissive_strength/emissiveStrength", "emissiveIntensity");
            this.bindMaterialScalar(materialIndex, pbrMaterials, "extensions/KHR_materials_transmission/transmissionFactor", "transmission");
            this.bindMaterialScalar(materialIndex, pbrMaterials, "extensions/KHR_materials_clearcoat/clearcoatFactor", "clearcoat");
            this.bindMaterialScalar(materialIndex, pbrMaterials, "extensions/KHR_materials_ior/ior", "ior");
            this.bindMaterialScalar(materialIndex, pbrMaterials, "extensions/KHR_materials_volume/thicknessFactor", "thickness");
            this.bindTextureTransform(materialIndex, pbrMaterials, "pbrMetallicRoughness/baseColorTexture", (material) => material.map);
            this.bindTextureTransform(materialIndex, pbrMaterials, "pbrMetallicRoughness/metallicRoughnessTexture", (material) => material.metalnessMap ?? material.roughnessMap);
            this.bindTextureTransform(materialIndex, pbrMaterials, "normalTexture", (material) => material.normalMap);
            this.bindTextureTransform(materialIndex, pbrMaterials, "occlusionTexture", (material) => material.aoMap);
            this.bindTextureTransform(materialIndex, pbrMaterials, "emissiveTexture", (material) => material.emissiveMap);
        });

        this.model.animations.forEach((clip, animationIndex) => {
            this.scalarPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/playhead`, "float", () => this.animationPlayhead(animationIndex), undefined, true);
            this.scalarPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/virtualPlayhead`, "float", () => this.threeAnimations.get(animationIndex)?.virtualTime ?? this.animationPlayhead(animationIndex));
            this.scalarPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/minTime`, "float", () => 0, undefined, true);
            this.scalarPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/maxTime`, "float", () => clip.duration, undefined, true);
            this.scalarPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/isPlaying`, "bool", () => this.threeAnimations.has(animationIndex), undefined, true);
        });
    }

    private bindIfValid(
        path: string,
        typeName: string,
        get: () => unknown,
        set: ((value: unknown) => void) | undefined,
        readOnly = false,
    ): void {
        if (this.isValidJsonPtr(path)) {
            this.pointer(path, typeName, get, set, readOnly);
        }
    }

    private bindMaterialScalar(
        materialIndex: number,
        materials: ThreePbrMaterial[],
        pointerPath: string,
        property: ThreeScalarMaterialProperty,
    ): void {
        const path = `/materials/${materialIndex}/${pointerPath}`;
        this.bindIfValid(path, "float", () => [Number(materials[0][property])], (value) => {
            materials.forEach((material) => {
                material[property] = scalar(value);
                material.needsUpdate = true;
            });
        });
    }

    private bindTextureTransform(
        materialIndex: number,
        materials: ThreePbrMaterial[],
        texturePath: string,
        selectTexture: (material: ThreePbrMaterial) => Texture | null,
    ): void {
        const textures = materials.map(selectTexture).filter((texture): texture is Texture => texture !== null);
        if (textures.length === 0) {
            return;
        }
        const prefix = `/materials/${materialIndex}/${texturePath}/extensions/KHR_texture_transform`;
        this.bindIfValid(`${prefix}/offset`, "float2", () => textures[0].offset.toArray(), (value) => textures.forEach((texture) => texture.offset.fromArray(asArray(value))));
        this.bindIfValid(`${prefix}/scale`, "float2", () => textures[0].repeat.toArray(), (value) => textures.forEach((texture) => texture.repeat.fromArray(asArray(value))));
        this.bindIfValid(`${prefix}/rotation`, "float", () => [textures[0].rotation], (value) => textures.forEach((texture) => texture.rotation = scalar(value)));
    }

    private startThreeAnimation = (animationIndex: number, startTime: number, endTime: number, speed: number, callback: () => void): void => {
        const clip = this.model.animations[animationIndex];
        if (!clip) {
            return;
        }
        this.stopThreeAnimation(animationIndex);
        const action = this.model.mixer.clipAction(clip);
        action.reset();
        action.enabled = true;
        action.paused = false;
        action.time = clipTime(startTime, clip.duration, false);
        action.setEffectiveTimeScale(startTime <= endTime ? speed : -speed);
        action.play();
        this.threeAnimations.set(animationIndex, { action, callback, endTime, speed, virtualTime: startTime });
        this.startAnimationTimer();
        this.model.mixer.update(0);
    };

    private stopThreeAnimation = (animationIndex: number): void => {
        const active = this.threeAnimations.get(animationIndex);
        if (!active) {
            return;
        }
        active.action.paused = true;
        this.threeAnimations.delete(animationIndex);
        if (this.threeAnimations.size === 0) {
            this.stopAnimationTimer();
        }
    };

    private stopThreeAnimationAt = (animationIndex: number, stopTime: number, callback: () => void): void => {
        const active = this.threeAnimations.get(animationIndex);
        if (!active) {
            return;
        }
        const direction = active.virtualTime <= stopTime ? 1 : -1;
        active.endTime = stopTime;
        active.callback = callback;
        active.action.setEffectiveTimeScale(direction * active.speed);
    };

    private startAnimationTimer(): void {
        if (this.animationTimer !== null) {
            return;
        }
        this.lastAnimationTick = performance.now();
        this.animationTimer = setInterval(() => this.tickAnimations(), 1000 / 60);
    }

    private stopAnimationTimer(): void {
        if (this.animationTimer !== null) {
            clearInterval(this.animationTimer);
            this.animationTimer = null;
        }
    }

    private tickAnimations(): void {
        const now = performance.now();
        const delta = Math.max(0, (now - this.lastAnimationTick) / 1000);
        this.lastAnimationTick = now;
        this.model.mixer.update(delta);

        for (const [animationIndex, active] of [...this.threeAnimations]) {
            const direction = active.action.getEffectiveTimeScale() >= 0 ? 1 : -1;
            active.virtualTime += direction * active.speed * delta;
            const finished = direction > 0 ? active.virtualTime >= active.endTime : active.virtualTime <= active.endTime;
            if (!finished || !Number.isFinite(active.endTime)) {
                continue;
            }
            active.virtualTime = active.endTime;
            active.action.time = clipTime(active.endTime, active.action.getClip().duration, true);
            active.action.paused = true;
            this.model.mixer.update(0);
            this.threeAnimations.delete(animationIndex);
            active.callback();
        }
        if (this.threeAnimations.size === 0) {
            this.stopAnimationTimer();
        }
    }

    private animationPlayhead(animationIndex: number): number {
        return this.model.mixer.existingAction(this.model.animations[animationIndex])?.time ?? 0;
    }

    private detachPointerEvents(): void {
        this.domElement?.removeEventListener("pointermove", this.handlePointerMove);
        this.domElement?.removeEventListener("pointerleave", this.handlePointerLeave);
        this.domElement?.removeEventListener("click", this.handleClick);
        this.domElement = null;
    }

    private handlePointerMove = (event: PointerEvent): void => {
        const hit = this.pick(event, (object) => interactionEnabled(object, "hoverable"));
        this.hoverOn(hit ? findNodeIndex(hit.object) : undefined, 0);
    };

    private handlePointerLeave = (): void => {
        this.hoverOn(undefined, 0);
    };

    private handleClick = (event: MouseEvent): void => {
        const hit = this.pick(event, (object) => interactionEnabled(object, "selectable"));
        const nodeIndex = hit ? findNodeIndex(hit.object) : undefined;
        if (!hit || nodeIndex === undefined) {
            return;
        }
        this.select(
            nodeIndex,
            0,
            hit.point.toArray() as [number, number, number],
            this.raycaster.ray.origin.toArray() as [number, number, number],
        );
    };

    private pick(event: MouseEvent | PointerEvent, accept: (object: Object3D) => boolean): Intersection | undefined {
        if (!this.camera || !this.domElement) {
            return undefined;
        }
        const rect = this.domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            return undefined;
        }
        this.pointerNdc.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        return this.raycaster.intersectObjects(this.model.scene.children, true).find((intersection) => accept(intersection.object));
    }
}

function findMorphMeshes(node: Object3D): Mesh[] {
    const result: Mesh[] = [];
    node.traverse((object) => {
        if (object instanceof Mesh && object.morphTargetInfluences) {
            result.push(object);
        }
    });
    return result;
}

function findNodeIndex(object: Object3D): number | undefined {
    for (let current: Object3D | null = object; current; current = current.parent) {
        if (Number.isInteger(current.userData.gltfNodeIndex)) {
            return current.userData.gltfNodeIndex;
        }
    }
    return undefined;
}

function interactionEnabled(object: Object3D, property: "hoverable" | "selectable"): boolean {
    for (let current: Object3D | null = object; current; current = current.parent) {
        if (current.userData[property] === false) {
            return false;
        }
    }
    return true;
}

function clipTime(virtualTime: number, duration: number, finalFrame: boolean): number {
    if (!Number.isFinite(virtualTime) || duration <= 0) {
        return 0;
    }
    const wrapped = ((virtualTime % duration) + duration) % duration;
    return finalFrame && virtualTime !== 0 && wrapped === 0 ? duration : wrapped;
}

function asArray(value: unknown): number[] {
    return Array.isArray(value) ? value.map(Number) : [Number(value)];
}

function scalar(value: unknown): number {
    return Number(Array.isArray(value) ? value[0] : value);
}
