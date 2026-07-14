import type {
    GLTF,
    GLTFLoader,
    GLTFLoaderPlugin,
    GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Material, Object3D } from "three";
import { GLTFAnimationPointerExtension } from "@needle-tools/three-animation-pointer";
import {
    buildThreeLoadedModel,
    type ThreeLoadedModel,
} from "./ThreeLoadedModel";
import {
    attachInteractivityRuntime,
    getInteractivityRuntime,
    InteractivityRuntime,
    type InteractivityRuntimeOptions,
} from "./InteractivityRuntime";

export interface GLTFInteractivityPluginOptions extends InteractivityRuntimeOptions {
    autoStart?: boolean;
    initializeWithoutExtension?: boolean;
    onReady?: (runtime: InteractivityRuntime, gltf: GLTF) => void | Promise<void>;
}

export interface GLTFInteractivityRegistrationOptions extends GLTFInteractivityPluginOptions {
    registerAnimationPointer?: boolean;
}

export type GLTFInteractivityPluginFactory = (parser: GLTFParser) => GLTFInteractivityPlugin;

export class GLTFInteractivityPlugin implements GLTFLoaderPlugin {
    readonly name = "KHR_interactivity";

    private dependencyMaterials: Material[] = [];
    private dependencyNodes: Object3D[] = [];
    private shouldInitialize = false;

    constructor(
        private readonly parser: GLTFParser,
        private readonly options: GLTFInteractivityPluginOptions = {},
    ) {}

    async beforeRoot(): Promise<void> {
        this.shouldInitialize = this.options.initializeWithoutExtension === true
            || this.parser.json.extensions?.KHR_interactivity !== undefined;
        if (!this.shouldInitialize) return;

        [this.dependencyMaterials, this.dependencyNodes] = await Promise.all([
            this.parser.getDependencies("material") as Promise<Material[]>,
            this.parser.getDependencies("node") as Promise<Object3D[]>,
        ]);
    }

    async afterRoot(gltf: GLTF): Promise<void> {
        if (!this.shouldInitialize || getInteractivityRuntime(gltf)) return;

        const model: ThreeLoadedModel = buildThreeLoadedModel(
            gltf,
            this.dependencyMaterials,
            this.dependencyNodes,
        );
        const runtime = new InteractivityRuntime(model, this.options);
        attachInteractivityRuntime(gltf, runtime);
        attachInteractivityRuntime(model, runtime);
        try {
            await this.options.onReady?.(runtime, gltf);
            if (this.options.autoStart !== false) runtime.start();
        } catch (error) {
            runtime.dispose();
            throw error;
        }
    }
}

export function registerGLTFInteractivity(
    loader: GLTFLoader,
    options: GLTFInteractivityRegistrationOptions = {},
): () => void {
    const animationPointerFactory = (parser: GLTFParser) => new GLTFAnimationPointerExtension(parser);
    const factory: GLTFInteractivityPluginFactory = (parser) => new GLTFInteractivityPlugin(parser, options);
    if (options.registerAnimationPointer !== false) loader.register(animationPointerFactory);
    loader.register(factory);
    return () => {
        loader.unregister(factory);
        if (options.registerAnimationPointer !== false) loader.unregister(animationPointerFactory);
    };
}
