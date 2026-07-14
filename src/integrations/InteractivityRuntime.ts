import type { Camera } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BasicBehaveEngine } from "../BasicBehaveEngine/BasicBehaveEngine";
import { DOMEventBus } from "../BasicBehaveEngine/eventBuses/DOMEventBus";
import type { IEventBus } from "../BasicBehaveEngine/IBehaveEngine";
import type { IInteractivityGraph } from "../BasicBehaveEngine/types/InteractivityGraph";
import type { ThreeLoadedModel } from "./ThreeLoadedModel";
import { ThreeDecorator } from "../decorators/ThreeDecorator";

export const INTERACTIVITY_RUNTIME = Symbol.for("@needle-tools/gltf-interactivity/runtime");

export interface InteractivityRuntimeOptions {
    fps?: number;
    eventBus?: IEventBus | (() => IEventBus);
    manualAnimationUpdates?: boolean;
}

export class InteractivityRuntime {
    readonly engine: BasicBehaveEngine;
    readonly decorator: ThreeDecorator;
    readonly model: ThreeLoadedModel;

    private readonly cleanupCallbacks = new Set<() => void>();
    private disposed = false;

    constructor(model: ThreeLoadedModel, options: InteractivityRuntimeOptions = {}) {
        this.model = model;
        const eventBus = typeof options.eventBus === "function"
            ? options.eventBus()
            : options.eventBus ?? new DOMEventBus();
        this.engine = new BasicBehaveEngine(options.fps ?? 60, eventBus);
        this.decorator = new ThreeDecorator(this.engine, model);
        this.decorator.setManualAnimationUpdates(options.manualAnimationUpdates ?? false);
    }

    get graph(): IInteractivityGraph | undefined {
        const interactivity = this.model.gltf.extensions?.KHR_interactivity;
        return interactivity?.graphs?.[interactivity.graph ?? 0];
    }

    start(graph: IInteractivityGraph | undefined = this.graph): boolean {
        if (!graph) return false;
        this.decorator.loadBehaveGraph(graph);
        return true;
    }

    setCamera(camera: Camera): void {
        this.decorator.setCamera(camera);
    }

    attachPointerEvents(domElement: HTMLElement): void {
        this.decorator.attachPointerEvents(domElement);
    }

    update(deltaSeconds: number): void {
        this.decorator.updateAnimations(deltaSeconds);
    }

    addCleanup(callback: () => void): () => void {
        this.cleanupCallbacks.add(callback);
        return () => this.cleanupCallbacks.delete(callback);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const callback of [...this.cleanupCallbacks]) callback();
        this.cleanupCallbacks.clear();
        this.decorator.dispose();
    }
}

type RuntimeHost = GLTF | ThreeLoadedModel;

export function attachInteractivityRuntime(host: RuntimeHost, runtime: InteractivityRuntime): void {
    Object.defineProperty(host, INTERACTIVITY_RUNTIME, {
        configurable: true,
        enumerable: false,
        value: runtime,
    });
}

export function getInteractivityRuntime(host: RuntimeHost | null | undefined): InteractivityRuntime | undefined {
    return host == null
        ? undefined
        : (host as RuntimeHost & { [INTERACTIVITY_RUNTIME]?: InteractivityRuntime })[INTERACTIVITY_RUNTIME];
}
