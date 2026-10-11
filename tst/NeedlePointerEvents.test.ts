import {
    Group,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
    Vector3,
    Ray,
    PerspectiveCamera,
} from "three";
import {
    attachNeedlePointerEvents,
    attachNeedleXRPointerEvents,
    type NeedleContext,
} from "../src/integrations/NeedlePointerEvents";
import type { ThreeLoadedModel } from "../src/integrations/ThreeLoadedModel";
import type { ThreeDecorator } from "../src/decorators/ThreeDecorator";
import { jest } from "@jest/globals";

describe("Needle pointer events", () => {
    it("maps Needle raycast hits to glTF hover and selection events", () => {
        const element = document.createElement("canvas");
        Object.defineProperty(element, "getBoundingClientRect", {
            value: () => ({ left: 10, top: 20, width: 200, height: 100 }),
        });
        const root = new Group();
        const node = new Group();
        node.userData.gltfNodeIndex = 7;
        const mesh = new Mesh(new SphereGeometry(1), new MeshBasicMaterial());
        node.add(mesh);
        root.add(node);

        const camera = new PerspectiveCamera(45, 2, 0.1, 100);
        camera.position.set(4, 5, 6);
        camera.lookAt(0, 0, 0);
        const context: NeedleContext = {
            mainCamera: camera,
            renderer: { domElement: element },
        };
        const decorator = {
            hoverOn: jest.fn(),
            select: jest.fn(),
        } as unknown as ThreeDecorator;
        const model = { scene: root } as ThreeLoadedModel;
        const detach = attachNeedlePointerEvents(context, model, decorator);

        element.dispatchEvent(
            new MouseEvent("pointermove", { clientX: 110, clientY: 70 }),
        );
        element.dispatchEvent(
            new MouseEvent("click", { clientX: 110, clientY: 70 }),
        );

        expect(decorator.hoverOn).toHaveBeenCalledWith(7, 0);
        expect(decorator.select).toHaveBeenCalledWith(
            7,
            0,
            expect.any(Array),
            [4, 5, 6],
        );

        detach();
        jest.clearAllMocks();
        element.dispatchEvent(
            new MouseEvent("click", { clientX: 110, clientY: 70 }),
        );
        expect(decorator.select).not.toHaveBeenCalled();
    });
});

describe("Needle XR target rays", () => {
    it("uses the selection event's current pose and camera rig before the controller update", () => {
        const scene = new Group();
        const mesh = new Mesh(new SphereGeometry(0.5), new MeshBasicMaterial());
        mesh.position.set(2, 1, -3);
        mesh.userData.gltfNodeIndex = 4;
        scene.add(mesh);
        const rig = new Group();
        rig.position.set(2, 1, 0);
        const camera = new PerspectiveCamera();
        rig.add(camera);
        const session = new EventTarget();
        const controller = {
            index: 3,
            inputSource: { targetRaySpace: {} } as XRInputSource,
            connected: true,
            isTracking: false,
            ray: new Ray(new Vector3(20, 20, 20), new Vector3(0, 0, -1)),
        };
        const context = {
            mainCamera: camera,
            xrSession: session,
            xr: { controllers: [controller], referenceSpace: {} },
            renderer: {
                domElement: document.createElement("canvas"),
                xr: { isPresenting: true },
            },
        } as unknown as NeedleContext;
        const decorator = { select: jest.fn(), hoverOn: jest.fn() };
        const input = attachNeedleXRPointerEvents(
            context,
            { scene } as ThreeLoadedModel,
            decorator as unknown as ThreeDecorator,
        );
        const dispatch = (pose: unknown) => {
            const event = new Event("select");
            Object.defineProperties(event, {
                inputSource: { value: controller.inputSource },
                frame: { value: { getPose: () => pose } },
            });
            session.dispatchEvent(event);
        };
        dispatch({
            transform: {
                position: { x: 0.1, y: 0.1, z: 0 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
        });
        expect(decorator.select).toHaveBeenCalledWith(
            4,
            3,
            expect.any(Array),
            [2.1, 1.1, 0],
        );
        decorator.select.mockClear();
        dispatch(null);
        expect(decorator.select).not.toHaveBeenCalled();
        input.dispose();
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
    });
    it("uses Needle world rays for both inputs, rejects disabled ancestors, and clears stale hover on exit/disconnect", () => {
        const scene = new Group();
        const parent = new Group();
        const mesh = new Mesh(new SphereGeometry(0.5), new MeshBasicMaterial());
        mesh.position.set(2, 1, -3);
        mesh.userData.gltfNodeIndex = 4;
        parent.add(mesh);
        scene.add(parent);
        const session = new EventTarget();
        const controllers = [0, 1].map((index) => ({
            index,
            inputSource: {} as XRInputSource,
            connected: true,
            isTracking: true,
            ray: new Ray(new Vector3(2.1, 1.1, 0), new Vector3(0, 0, -1)),
        }));
        const context = {
            mainCamera: {},
            xrSession: session,
            xr: { controllers },
            renderer: {
                domElement: document.createElement("canvas"),
                xr: { isPresenting: true },
            },
            physics: {},
        } as unknown as NeedleContext;
        const decorator = { select: jest.fn(), hoverOn: jest.fn() };
        // Attach while already presenting: no connection event is needed to initialize.
        const input = attachNeedleXRPointerEvents(
            context,
            { scene } as ThreeLoadedModel,
            decorator as unknown as ThreeDecorator,
        );
        const select = (index: number) => {
            const event = new Event("select");
            Object.defineProperty(event, "inputSource", {
                value: controllers[index].inputSource,
            });
            session.dispatchEvent(event);
        };
        input.update();
        select(0);
        select(1);
        expect(decorator.hoverOn).toHaveBeenCalledWith(4, 0);
        expect(decorator.hoverOn).toHaveBeenCalledWith(4, 1);
        expect(decorator.select).toHaveBeenCalledWith(
            4,
            0,
            expect.any(Array),
            [2.1, 1.1, 0],
        );
        expect(decorator.select).toHaveBeenCalledWith(
            4,
            1,
            expect.any(Array),
            [2.1, 1.1, 0],
        );
        expect((decorator.select.mock.calls[0][2] as number[])[2]).toBeCloseTo(
            -2.5,
            1,
        );

        decorator.select.mockClear();
        parent.userData.selectable = false;
        parent.userData.hoverable = false;
        input.update();
        select(0);
        expect(decorator.select).not.toHaveBeenCalled();
        expect(decorator.hoverOn).toHaveBeenLastCalledWith(undefined, 1);
        delete parent.userData.selectable;
        delete parent.userData.hoverable;
        parent.visible = false;
        select(1);
        expect(decorator.select).not.toHaveBeenCalled();
        parent.visible = true;
        controllers[0].connected = false;
        input.update();
        select(0);
        expect(decorator.select).not.toHaveBeenCalled();
        expect(decorator.hoverOn).toHaveBeenLastCalledWith(undefined, 0);
        context.renderer.xr!.isPresenting = false;
        input.update();
        select(1);
        expect(decorator.hoverOn).toHaveBeenLastCalledWith(undefined, 1);
        expect(decorator.select).not.toHaveBeenCalled();

        const nextSession = new EventTarget();
        context.xrSession = nextSession as XRSession;
        context.renderer.xr!.isPresenting = true;
        select(1); // Reject the ended session even before the next Needle update.
        expect(decorator.select).not.toHaveBeenCalled();
        input.update();
        select(1); // Old session no longer owns this input.
        expect(decorator.select).not.toHaveBeenCalled();
        input.dispose();
        input.dispose();
        const event = new Event("select");
        Object.defineProperty(event, "inputSource", {
            value: controllers[1].inputSource,
        });
        nextSession.dispatchEvent(event);
        input.update();
        expect(decorator.select).not.toHaveBeenCalled();
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
    });
});
