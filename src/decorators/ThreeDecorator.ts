import {
    AnimationAction,
    Camera,
    Intersection,
    Object3D,
    Raycaster,
    Vector2,
} from "three";
import { ADecorator } from "../BasicBehaveEngine/ADecorator";
import { BehaveEngineNode } from "../BasicBehaveEngine/BehaveEngineNode";
import { IBehaveEngine } from "../BasicBehaveEngine/IBehaveEngine";
import { IInteractivityFlow } from "../BasicBehaveEngine/types/InteractivityGraph";
import { OnHoverIn } from "../BasicBehaveEngine/nodes/event/OnHoverIn";
import { OnHoverOut } from "../BasicBehaveEngine/nodes/event/OnHoverOut";
import { OnSelect } from "../BasicBehaveEngine/nodes/event/OnSelect";
import { trackSceneInteraction } from "../utils/analytics";
import { SUPPORTED_GLTF_EXTENSIONS } from "../diagnostics";
import { assetExtensionEnabled, KHR_INTERACTIVITY_LIMITS, parseGltfVersion } from "../objectModel/assetCapabilities";
import type { ThreeLoadedModel } from "../integrations/ThreeLoadedModel";
import { attachPointerTap } from "../integrations/pointerTap";
import { registerThreeMaterialPointers } from "./threeMaterialPointers";
import { registerThreeActiveCameraPointers, registerThreeScenePointers } from "./threeScenePointers";
import { registerThreeStructuralPointers } from "./threeStructuralPointers";
import type { ThreePointerBinder } from "./threePointerTypes";

interface ActiveAnimation {
    action: AnimationAction;
    callback: () => void;
    endTime: number;
    speed: number;
    virtualTime: number;
}

interface PointerBinding {
    get: () => unknown;
    set?: (value: unknown) => void;
    typeName: string;
    readOnly: boolean;
}

export class ThreeDecorator extends ADecorator {
    private readonly model: ThreeLoadedModel;
    private readonly pointerBindings = new Map<string, PointerBinding>();
    private readonly eventPointerPaths = new Set<string>();
    private readonly raycaster = new Raycaster();
    private readonly pointerNdc = new Vector2();
    private readonly threeAnimations = new Map<number, ActiveAnimation>();
    private camera: Camera | null = null;
    private domElement: HTMLElement | null = null;
    private detachTap: (() => void) | undefined;
    private animationTimer: ReturnType<typeof setInterval> | null = null;
    private lastAnimationTick = 0;
    private manualAnimationUpdates = false;

    constructor(behaveEngine: IBehaveEngine, model: ThreeLoadedModel) {
        super(behaveEngine);
        this.model = model;
        this.bridgePointerHooks();
        this.bridgeEngineHooks();
        this.registerKnownPointers();
        this.registerBehaveEngineNode("event/onSelect", OnSelect);
        this.registerBehaveEngineNode("event/onHoverIn", OnHoverIn);
        this.registerBehaveEngineNode("event/onHoverOut", OnHoverOut);
    }

    setCamera(camera: Camera): void {
        if (this.camera === camera) return;
        this.camera = camera;
        registerThreeActiveCameraPointers(camera, this.bindPointer);
    }

    processNodeStarted = (node: BehaveEngineNode): void => {
        // report user interactions with the running scene (select/hover); filtered + throttled
        trackSceneInteraction(node.declaration?.op);
    };
    processAddingNodeToQueue = (_flow: IInteractivityFlow): void => undefined;
    processExecutingNextNode = (_flow: IInteractivityFlow): void => undefined;
    getWorld = (): ThreeLoadedModel => this.model;
    getParentNodeIndex = (nodeIndex: number): number | undefined => {
        const parentIndex = this.model.gltf.nodes?.findIndex((node) => node.children?.includes(nodeIndex)) ?? -1;
        return parentIndex === -1 ? undefined : parentIndex;
    };
    startAnimation = (animationIndex: number, startTime: number, endTime: number, speed: number, callback: () => void): void => {
        this.startThreeAnimation(animationIndex, startTime, endTime, speed, callback);
    };
    stopAnimation = (animationIndex: number): void => this.stopThreeAnimation(animationIndex);
    stopAnimationAt = (animationIndex: number, stopTime: number, callback: () => void): void => this.stopThreeAnimationAt(animationIndex, stopTime, callback);

    registerKnownPointers = (): void => {
        registerThreeStructuralPointers(this.model, this.bindPointer);
        registerThreeScenePointers(this.model, this.bindPointer);
        registerThreeMaterialPointers(this.model, this.bindPointer);
        this.registerAnimationPointers();
        this.registerAssetCapabilityPointers();
        this.registerEventPointers(this.model.gltf.extensions?.KHR_interactivity?.graphs?.[
            this.model.gltf.extensions?.KHR_interactivity?.graph ?? 0
        ]);
    };

    override loadBehaveGraph(behaveGraph: any, runGraph = true): void {
        this.registerEventPointers(behaveGraph);
        super.loadBehaveGraph(behaveGraph, runGraph);
    }

    attachPointerEvents(domElement: HTMLElement): void {
        this.detachPointerEvents();
        this.domElement = domElement;
        domElement.addEventListener("pointermove", this.handlePointerMove);
        domElement.addEventListener("pointerleave", this.handlePointerLeave);
        this.detachTap = attachPointerTap(domElement, this.handleTap);
    }

    setManualAnimationUpdates(enabled: boolean): void {
        if (this.manualAnimationUpdates === enabled) return;
        this.manualAnimationUpdates = enabled;
        if (enabled) {
            this.stopAnimationTimer();
        } else if (this.threeAnimations.size > 0) {
            this.startAnimationTimer();
        }
    }

    updateAnimations(deltaSeconds: number): void {
        if (!this.manualAnimationUpdates) return;
        this.advanceAnimations(Math.max(0, deltaSeconds));
    }

    override dispose(): void {
        this.detachPointerEvents();
        this.stopAnimationTimer();
        this.model.mixer.stopAllAction();
        super.dispose();
    }

    private registerAnimationPointers(): void {
        this.model.animations.forEach((clip, animationIndex) => {
            this.bindPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/playhead`, "float", () => [this.animationPlayhead(animationIndex)], undefined, true);
            this.bindPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/virtualPlayhead`, "float", () => [this.threeAnimations.get(animationIndex)?.virtualTime ?? this.animationPlayhead(animationIndex)], undefined, true);
            this.bindPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/minTime`, "float", () => [animationMinTime(clip)], undefined, true);
            this.bindPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/maxTime`, "float", () => [clip.duration], undefined, true);
            this.bindPointer(`/animations/${animationIndex}/extensions/KHR_interactivity/isPlaying`, "bool", () => [this.threeAnimations.has(animationIndex)], undefined, true);
        });
    }

    // Asset Capabilities & runtime limits (KHR_interactivity spec 4.2.1 / 4.2.2), mirroring the
    // Babylon decorator: extensions that are both used by the asset and supported get a concrete
    // `enabled` = true pointer; every other asset extension `enabled` query resolves to false via
    // the assetExtensionEnabled fallback in the pointer hooks below.
    private registerAssetCapabilityPointers(): void {
        const [majorVersion, minorVersion] = parseGltfVersion(this.model.gltf.asset?.version);
        this.bindPointer(`/extensions/KHR_interactivity/asset/majorVersion`, "int", () => [majorVersion], undefined, true);
        this.bindPointer(`/extensions/KHR_interactivity/asset/minorVersion`, "int", () => [minorVersion], undefined, true);
        for (const extensionName of this.extensionsUsed) {
            if (!SUPPORTED_GLTF_EXTENSIONS.has(extensionName)) continue;
            this.bindPointer(`/extensions/KHR_interactivity/asset/extensions/${extensionName}/enabled`, "bool", () => [true], undefined, true);
        }
        for (const { name, value } of KHR_INTERACTIVITY_LIMITS) {
            this.bindPointer(`/extensions/KHR_interactivity/limits/${name}`, "int", () => [value], undefined, true);
        }
    }

    private get extensionsUsed(): string[] {
        return this.model.gltf.extensionsUsed ?? [];
    }

    private registerEventPointers(graph: any): void {
        this.eventPointerPaths.forEach((path) => this.pointerBindings.delete(path));
        this.eventPointerPaths.clear();
        const count = (graph?.events?.length ?? 0) + 2;
        for (let index = 0; index < count; index++) {
            const path = `/extensions/KHR_interactivity/events/${index}`;
            this.bindPointer(path, "ref", () => [path], undefined, true);
            this.eventPointerPaths.add(path);
        }
    }

    private bindPointer: ThreePointerBinder = (path, typeName, get, set, readOnly = false): void => {
        this.pointerBindings.set(path, { get, set, typeName, readOnly });
    };

    private bridgePointerHooks(): void {
        this.behaveEngine.isValidJsonPtr = this.isValidJsonPtrExact;
        this.behaveEngine.isReadOnly = this.isReadOnlyExact;
        this.behaveEngine.getPathValue = this.getPathValueExact;
        this.behaveEngine.getPathTypeName = this.getPathTypeNameExact;
        this.behaveEngine.setPathValue = this.setPathValueExact;
        this.behaveEngine.getRegisteredJsonPointers = () => [...this.pointerBindings.keys()].sort();
    }

    // Asset extension `enabled` pointers are valid for any extension name (spec 4.2.1) — the boolean
    // conveys support — so they fall back to assetExtensionEnabled when not concretely registered.
    private isValidJsonPtrExact = (path: string): boolean => this.pointerBindings.has(path) || this.isActiveDelayRef(path) || assetExtensionEnabled(path, this.extensionsUsed) !== undefined;
    private isReadOnlyExact = (path: string): boolean => this.pointerBindings.get(path)?.readOnly ?? (this.isActiveDelayRef(path) || assetExtensionEnabled(path, this.extensionsUsed) !== undefined);
    private getPathValueExact = (path: string): unknown => {
        const binding = this.pointerBindings.get(path);
        if (binding) return binding.get();
        if (this.isActiveDelayRef(path)) return [path];
        const enabled = assetExtensionEnabled(path, this.extensionsUsed);
        return enabled === undefined ? undefined : [enabled];
    };
    private getPathTypeNameExact = (path: string): string | undefined => this.pointerBindings.get(path)?.typeName ?? (this.isActiveDelayRef(path) ? "ref" : (assetExtensionEnabled(path, this.extensionsUsed) !== undefined ? "bool" : undefined));
    private setPathValueExact = (path: string, value: unknown): void => {
        const binding = this.pointerBindings.get(path);
        if (binding && !binding.readOnly) binding.set?.(value);
    };

    private isActiveDelayRef(path: string): boolean {
        const match = path.match(/^\/extensions\/KHR_interactivity\/delays\/(\d+)$/);
        return match !== null && (this.behaveEngine as any).getScheduledDelay?.(Number(match[1])) !== undefined;
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
        if (this.manualAnimationUpdates || this.animationTimer !== null) {
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
        this.advanceAnimations(delta);
    }

    private advanceAnimations(delta: number): void {
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
        this.detachTap?.();
        this.detachTap = undefined;
        this.domElement = null;
    }

    private handlePointerMove = (event: PointerEvent): void => {
        const hit = this.pick(event, (object) => interactionEnabled(object, "hoverable"));
        this.hoverOn(hit ? findNodeIndex(hit.object) : undefined, 0);
    };

    private handlePointerLeave = (): void => {
        this.hoverOn(undefined, 0);
    };

    private handleTap = (event: MouseEvent | PointerEvent): void => {
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

function animationMinTime(clip: { tracks: Array<{ times: ArrayLike<number> }> }): number {
    return clip.tracks.length === 0 ? 0 : Math.min(...clip.tracks.map((track) => track.times[0] ?? 0));
}
