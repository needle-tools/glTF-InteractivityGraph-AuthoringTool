import { Camera, Group, OrthographicCamera, PerspectiveCamera } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { registerGLTFInteractivity } from "../src/integrations/GLTFInteractivityPlugin";
import { getInteractivityRuntime, InteractivityRuntime } from "../src/integrations/InteractivityRuntime";
import { Camera as BabylonCamera, FreeCamera, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { registerBabylonCameraPointers } from "../src/decorators/babylonCameraPointers";
import { TextDecoder } from "node:util";

Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: TextDecoder });

const active = "/extensions/KHR_interactivity/activeCamera/";
const projectionFields = ["perspective/aspectRatio", "perspective/yfov", "perspective/znear", "perspective/zfar", "orthographic/xmag", "orthographic/ymag", "orthographic/znear", "orthographic/zfar"];
async function load(cameras: object[] = [], nodes: object[] = [], graph?: object): Promise<InteractivityRuntime> {
    const loader = new GLTFLoader();
    registerGLTFInteractivity(loader, { initializeWithoutExtension: true, autoStart: false });
    const result = await loader.parseAsync(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: nodes.length ? [0] : [] }], nodes, cameras, ...(graph ? {extensions: {KHR_interactivity: {graph: 0, graphs: [graph]}}} : {}) }), "");
    return getInteractivityRuntime(result)!;
}

describe("Three and Needle camera object model", () => {
    it("dispatches custom events by the graph's declared id", async () => {
        const runtime = await load([], [], {types: [{signature: "bool"}], variables: [{type: 0, value: [false]}], events: [{id: "toggle", values: {enabled: {type: 0}}}], declarations: [{op: "event/receive"}, {op: "variable/set"}], nodes: [{declaration: 0, configuration: {event: {value: [0]}}, flows: {out: {node: 1, socket: "in"}}}, {declaration: 1, configuration: {variables: {value: [0]}}, values: {"0": {node: 0, socket: "enabled", type: 0}}}]});
        try {
            runtime.decorator.loadBehaveGraph(runtime.graph, false);
            runtime.sendEvent("toggle", {enabled: true});
            runtime.engine.executeEventQueueTick();
            expect(runtime.engine.variables[0].value).toEqual([true]);
            expect(() => runtime.sendEvent("missing")).toThrow("Unknown interactivity event");
        } finally { runtime.dispose(); }
    });
    it("keeps every unavailable active-camera field valid, read-only and NaN, including after clearing a camera", async () => {
        const runtime = await load();
        try {
            for (const camera of [null, new PerspectiveCamera(), null]) {
                runtime.setCamera(camera);
                for (const field of ["position", "rotation", ...projectionFields]) {
                    expect(runtime.decorator.isValidJsonPtr(active + field)).toBe(true);
                    expect(runtime.decorator.isReadOnly(active + field)).toBe(true);
                    if (!camera) expect((runtime.decorator.getPathValue(active + field) as number[]).every(Number.isNaN)).toBe(true);
                }
            }
        } finally { runtime.dispose(); }
    });

    it("reads zoomed and offset perspective projection and global pose", async () => {
        const runtime = await load();
        const camera = new PerspectiveCamera(60, 1.5, 0.1, Infinity);
        const rig = new Group(); rig.position.set(3, 4, 5); rig.rotation.y = 0.4;
        rig.add(camera); camera.position.set(0, 0, 2); camera.zoom = 2; camera.updateProjectionMatrix();
        try {
            runtime.setCamera(camera);
            expect((runtime.decorator.getPathValue(active + "perspective/yfov") as number[])[0]).toBeCloseTo(camera.getEffectiveFOV() * Math.PI / 180);
            expect(runtime.decorator.getPathValue(active + "perspective/zfar")).toEqual([Infinity]);
            expect(runtime.decorator.getPathValue(active + "position")).toEqual(camera.getWorldPosition(camera.position.clone()).toArray());
            expect(runtime.decorator.getPathValue(active + "rotation")).toEqual(camera.getWorldQuaternion(camera.quaternion.clone()).toArray());
            camera.setViewOffset(1200, 800, 100, 50, 600, 400);
            const m = camera.projectionMatrix.elements;
            const topAngle = Math.atan((m[9] + 1) / m[5]);
            const bottomAngle = Math.atan((m[9] - 1) / m[5]);
            expect((runtime.decorator.getPathValue(active + "perspective/yfov") as number[])[0]).toBeCloseTo(topAngle - bottomAngle);
            expect((runtime.decorator.getPathValue(active + "orthographic/xmag") as number[])[0]).toBeNaN();
        } finally { runtime.dispose(); }
    });

    it("reads effective orthographic dimensions and switches projection families", async () => {
        const runtime = await load();
        const camera = new OrthographicCamera(-2, 2, 3, -3, 0.2, 70);
        camera.zoom = 2; camera.updateProjectionMatrix();
        try {
            runtime.setCamera(camera);
            expect(runtime.decorator.getPathValue(active + "orthographic/xmag")).toEqual([1]);
            expect(runtime.decorator.getPathValue(active + "orthographic/ymag")).toEqual([1.5]);
            expect(runtime.decorator.getPathValue(active + "orthographic/znear")).toEqual([0.2]);
            expect(runtime.decorator.getPathValue(active + "orthographic/zfar")).toEqual([70]);
            expect((runtime.decorator.getPathValue(active + "perspective/yfov") as number[])[0]).toBeNaN();
            runtime.setCamera(new PerspectiveCamera());
            expect((runtime.decorator.getPathValue(active + "orthographic/xmag") as number[])[0]).toBeNaN();
        } finally { runtime.dispose(); }
    });

    it("mutates both asset projections without touching a nested camera", async () => {
        const runtime = await load([
            { type: "perspective", perspective: { yfov: Math.PI / 3, aspectRatio: 1.5, znear: 0.1, zfar: 100 } },
            { type: "perspective", perspective: { yfov: Math.PI / 4, znear: 0.2 } },
            { type: "orthographic", orthographic: { xmag: 2, ymag: 3, znear: 0.1, zfar: 100 } },
        ], [{ camera: 0, children: [1] }, { camera: 1 }]);
        try {
            const d = runtime.decorator;
            const child = runtime.model.nodes[1] as PerspectiveCamera;
            for (const [field, value] of Object.entries({ aspectRatio: 2, yfov: Math.PI / 2, znear: 0.3, zfar: 50 })) d.setPathValue("/cameras/0/perspective/" + field, [value]);
            expect(child.fov).toBeCloseTo(45);
            expect(runtime.model.cameraInstances[0]).not.toContain(child);
            const p = runtime.model.cameraInstances[0][0] as PerspectiveCamera;
            expect([p.fov, p.aspect, p.near, p.far]).toEqual([90, 2, 0.3, 50]);
            for (const [field, value] of Object.entries({ xmag: 4, ymag: 5, znear: 0.4, zfar: 60 })) d.setPathValue("/cameras/2/orthographic/" + field, [value]);
            const o = runtime.model.cameraInstances[2][0] as OrthographicCamera;
            expect([o.left, o.right, o.bottom, o.top, o.near, o.far]).toEqual([-4, 4, -5, 5, 0.4, 60]);
            expect(d.isValidJsonPtr("/cameras/1/perspective/aspectRatio")).toBe(false);
            expect(d.isValidJsonPtr("/cameras/1/perspective/zfar")).toBe(false);
        } finally { runtime.dispose(); }
    });
});

describe("Babylon camera object model", () => {
    it("writes authored camera parameters to every instance and rebuilds projection matrices", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        const tag = (camera: FreeCamera, index: number): void => {
            Object.assign(camera, { _internalMetadata: { gltf: { pointers: [`/cameras/${index}`] } } });
        };
        const p = new FreeCamera("perspective", Vector3.Zero(), scene), clone = new FreeCamera("instance", Vector3.Zero(), scene), o = new FreeCamera("orthographic", Vector3.Zero(), scene);
        tag(p, 0); tag(clone, 0); tag(o, 1); o.mode = BabylonCamera.ORTHOGRAPHIC_CAMERA;
        o.orthoLeft = -2; o.orthoRight = 2; o.orthoBottom = -3; o.orthoTop = 3;
        scene.metadata = { gltfCameraDefinitions: [{ perspective: { aspectRatio: 1.5, yfov: 0.8, znear: 0.1, zfar: 100 } }, { orthographic: { xmag: 2, ymag: 3, znear: 0.1, zfar: 100 } }] };
        const bindings = new Map<string, { get: () => number[]; set?: (value: number[]) => void }>();
        registerBabylonCameraPointers(scene, (path, _type, get, set) => bindings.set(path, { get, set }));
        try {
            for (const [field, value] of Object.entries({ aspectRatio: 2, yfov: 1, znear: 0.25, zfar: 50 })) bindings.get("/cameras/0/perspective/" + field)!.set!([value]);
            for (const c of [p, clone]) {
                expect([c.fov, c.minZ, c.maxZ]).toEqual([1, 0.25, 50]);
                expect(c.getProjectionMatrix().m[5] / c.getProjectionMatrix().m[0]).toBeCloseTo(2);
            }
            for (const [field, value] of Object.entries({ xmag: 4, ymag: 5, znear: 0.3, zfar: 60 })) bindings.get("/cameras/1/orthographic/" + field)!.set!([value]);
            expect([o.orthoLeft, o.orthoRight, o.orthoBottom, o.orthoTop, o.minZ, o.maxZ]).toEqual([-4, 4, -5, 5, 0.3, 60]);
        } finally { scene.dispose(); engine.dispose(); }
    });
    it("reads global pose, both projection modes and unavailable data", () => {
        const engine = new NullEngine({ renderWidth: 600, renderHeight: 400, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
        const scene = new Scene(engine); scene.useRightHandedSystem = true;
        const bindings = new Map<string, () => number[]>();
        registerBabylonCameraPointers(scene, (path, _type, get) => bindings.set(path, get));
        const get = (field: string) => bindings.get(active + field)!();
        try {
            expect(get("position").every(Number.isNaN)).toBe(true);
            expect(get("perspective/yfov").every(Number.isNaN)).toBe(true);
            const rig = new TransformNode("rig", scene); rig.position.set(3, 4, 5);
            const camera = new FreeCamera("camera", new Vector3(1, 2, 3), scene); camera.parent = rig; camera.fov = 0.8; scene.activeCamera = camera;
            expect(get("position")).toEqual([4, 6, 8]);
            expect(get("perspective/yfov")[0]).toBeCloseTo(0.8);
            camera.mode = BabylonCamera.ORTHOGRAPHIC_CAMERA;
            camera.orthoLeft = -2; camera.orthoRight = 2; camera.orthoTop = 3; camera.orthoBottom = -3;
            expect(get("orthographic/xmag")[0]).toBeCloseTo(2);
            expect(get("orthographic/ymag")[0]).toBeCloseTo(3);
            expect(get("perspective/yfov")[0]).toBeNaN();
            scene.activeCamera = null; expect(get("rotation").every(Number.isNaN)).toBe(true);
        } finally { scene.dispose(); engine.dispose(); }
    });
});
