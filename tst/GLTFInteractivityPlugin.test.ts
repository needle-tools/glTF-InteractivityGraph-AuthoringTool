import { jest } from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";
import { AnimationClip, Group, PerspectiveCamera, VectorKeyframeTrack } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TextDecoder } from "util";
import {
    GLTFInteractivityPlugin,
    registerGLTFInteractivity,
} from "../src/integrations/GLTFInteractivityPlugin";
import { getInteractivityRuntime } from "../src/integrations/InteractivityRuntime";
import { resolveEmbeddedGraph } from "../src/components/engineViews/threeLoadedModel";
import type { IInteractivityGraph } from "../src/BasicBehaveEngine/types/InteractivityGraph";

const EMPTY_INTERACTIVITY_GLTF = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Interactive node" }],
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
        KHR_interactivity: {
            graph: 0,
            graphs: [{}],
        },
    },
};

beforeAll(() => {
    if (globalThis.TextDecoder === undefined) {
        Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: TextDecoder });
    }
});

describe("GLTFInteractivityPlugin", () => {
    it("rejects an invalid extension object unless the caller validates it (validateExtension: false)", async () => {
        const invalid = JSON.stringify({
            ...EMPTY_INTERACTIVITY_GLTF,
            extensions: { KHR_interactivity: { graph: "0", graphs: [{}] } },
        });
        const strict = new GLTFLoader();
        registerGLTFInteractivity(strict);
        await expect(strict.parseAsync(invalid, "")).rejects.toThrow(/Invalid KHR_interactivity/);

        const lenient = new GLTFLoader();
        registerGLTFInteractivity(lenient, { autoStart: false, validateExtension: false });
        const gltf = await lenient.parseAsync(invalid, "");
        const runtime = getInteractivityRuntime(gltf)!;
        expect(resolveEmbeddedGraph(runtime.model.gltf)).toEqual({
            error: "Invalid KHR_interactivity: default graph index is out of range",
        });
        const graph = {} as IInteractivityGraph;
        expect(resolveEmbeddedGraph({ extensions: { KHR_interactivity: { graphs: [graph] } } })).toEqual({ graph });
        runtime.dispose();
    });

    it("attaches one runtime during the real GLTFLoader lifecycle", async () => {
        const loader = new GLTFLoader();
        registerGLTFInteractivity(loader);

        const gltf = await loader.parseAsync(JSON.stringify(EMPTY_INTERACTIVITY_GLTF), "");
        const runtime = getInteractivityRuntime(gltf);

        expect(runtime).toBeDefined();
        expect(getInteractivityRuntime(runtime!.model)).toBe(runtime);
        expect(runtime!.model.nodes).toHaveLength(1);
        expect(runtime!.model.nodes[0]?.name).toBe("Interactive_node");
        expect(runtime!.graph).toEqual(EMPTY_INTERACTIVITY_GLTF.extensions.KHR_interactivity.graphs[0]);
        runtime!.dispose();
    });

    it("starts the embedded graph before a real loader promise resolves", async () => {
        const loader = new GLTFLoader();
        registerGLTFInteractivity(loader);
        const fixture = JSON.parse(readFileSync(resolve(
            process.cwd(),
            "packages/gltf-interactivity/examples/fixture/interactive.gltf",
        ), "utf8"));
        delete fixture.nodes[0].mesh;
        delete fixture.meshes;
        delete fixture.accessors;
        delete fixture.bufferViews;
        delete fixture.buffers;

        const gltf = await loader.parseAsync(JSON.stringify(fixture), "");
        const runtime = getInteractivityRuntime(gltf);

        expect(runtime).toBeDefined();
        expect(runtime!.model.nodes[0]?.position.x).toBe(1);
        runtime!.dispose();
    });

    it("collects complete dependencies in beforeRoot and never rebuilds in afterRoot", async () => {
        const node = new Group();
        const getDependencies = jest.fn(async (kind: string) => kind === "node" ? [node] : []);
        const parser = {
            json: EMPTY_INTERACTIVITY_GLTF,
            associations: new Map(),
            getDependencies,
        };
        const plugin = new GLTFInteractivityPlugin(parser as any, { autoStart: false });
        await plugin.beforeRoot();

        const scene = new Group();
        scene.add(node);
        const gltf = {
            scene,
            scenes: [scene],
            animations: [],
            cameras: [],
            parser,
            userData: {},
        } as any;
        await plugin.afterRoot(gltf);
        const firstRuntime = getInteractivityRuntime(gltf);
        await plugin.afterRoot(gltf);

        expect(getDependencies.mock.calls.map(([kind]) => kind)).toEqual(["material", "node"]);
        expect(getInteractivityRuntime(gltf)).toBe(firstRuntime);
        firstRuntime!.dispose();
    });

    it("does not initialize files without KHR_interactivity unless explicitly requested", async () => {
        const loader = new GLTFLoader();
        registerGLTFInteractivity(loader, { autoStart: false });
        const gltf = await loader.parseAsync(JSON.stringify({
            asset: { version: "2.0" },
            scenes: [{}],
        }), "");

        expect(getInteractivityRuntime(gltf)).toBeUndefined();
    });

    it("disposes the runtime when setup rejects the loader lifecycle", async () => {
        const loader = new GLTFLoader();
        let dispose: ReturnType<typeof jest.spyOn> | undefined;
        registerGLTFInteractivity(loader, {
            onReady(runtime) {
                dispose = jest.spyOn(runtime, "dispose");
                throw new Error("setup failed");
            },
        });

        await expect(loader.parseAsync(JSON.stringify(EMPTY_INTERACTIVITY_GLTF), ""))
            .rejects.toThrow("setup failed");
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});

describe("Needle interactivity registration", () => {
    it("registers the loader plugin through Needle onImport and binds lifecycle cleanup", async () => {
        const updateCallbacks: Array<(context: unknown) => void> = [];
        const clearCallbacks: Array<(context: unknown) => void> = [];
        const addCustomExtensionPlugin = jest.fn();
        const removeCustomImportExtensionType = jest.fn();
        jest.unstable_mockModule("@needle-tools/engine", () => ({
            addCustomExtensionPlugin,
            removeCustomImportExtensionType,
            onUpdate: (callback: (context: unknown) => void) => {
                updateCallbacks.push(callback);
                return jest.fn();
            },
            onClear: (callback: (context: unknown) => void) => {
                clearCallbacks.push(callback);
                return jest.fn();
            },
        }));
        const { createNeedleInteractivityPlugin, registerNeedleInteractivity } = await eval(
            'import("../src/integrations/NeedleInteractivityPlugin")',
        ) as typeof import("../src/integrations/NeedleInteractivityPlugin");

        const context = {
            mainCamera: new PerspectiveCamera(),
            xrCamera: new PerspectiveCamera() as PerspectiveCamera | undefined,
            renderer: { domElement: document.createElement("canvas") },
            physics: {},
            time: { deltaTime: 1 / 60 },
        };
        context.xrCamera!.position.set(3, 4, 5);
        const loader = new GLTFLoader();
        const register = jest.spyOn(loader, "register");
        const plugin = createNeedleInteractivityPlugin({ autoStart: false, pointerEvents: false });
        plugin.onImport!(loader, "fixture.gltf", context as any);
        expect(register).toHaveBeenCalledTimes(1);
        const gltf = await loader.parseAsync(JSON.stringify(EMPTY_INTERACTIVITY_GLTF), "");
        const runtime = getInteractivityRuntime(gltf);
        const dispose = jest.spyOn(runtime!, "dispose");

        expect(runtime).toBeDefined();
        expect(runtime!.decorator.getPathValue("/extensions/KHR_interactivity/activeCamera/position")).toEqual([3, 4, 5]);
        expect(updateCallbacks).toHaveLength(1);
        expect(clearCallbacks).toHaveLength(1);
        // A long frame must not slow animation relative to graph delays and ticks.
        runtime!.model.animations.push(new AnimationClip("clock", 1, [
            new VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 1, 0, 0]),
        ]));
        runtime!.decorator.registerKnownPointers();
        jest.useFakeTimers();
        try {
            runtime!.decorator.startAnimation(0, 0, 1, 1, () => undefined);
            jest.advanceTimersByTime(120);
            context.time.deltaTime = 0.01;
            updateCallbacks[0](context);
            const playhead = runtime!.decorator.getPathValue("/animations/0/extensions/KHR_interactivity/playhead") as number[];
            expect(playhead[0]).toBeGreaterThan(0.1);
            expect(runtime!.model.scene.position.x).toBeCloseTo(playhead[0], 5);
            runtime!.decorator.stopAnimation(0);
        } finally { jest.useRealTimers(); }
        context.xrCamera = undefined;
        updateCallbacks[0](context);
        expect(runtime!.decorator.getPathValue("/extensions/KHR_interactivity/activeCamera/position")).toEqual([0, 0, 0]);
        clearCallbacks[0](context);
        expect(dispose).toHaveBeenCalledTimes(1);

        const unregister = registerNeedleInteractivity({ pointerEvents: false });
        expect(addCustomExtensionPlugin).toHaveBeenCalledTimes(1);
        const registeredPlugin = addCustomExtensionPlugin.mock.calls[0][0];
        unregister();
        expect(removeCustomImportExtensionType).toHaveBeenCalledWith(registeredPlugin);
    });
});
