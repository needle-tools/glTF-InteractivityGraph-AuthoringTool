import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { attachNeedlePointerEvents, type NeedleContext } from "../src/integrations/NeedlePointerEvents";
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

        const raycast = jest.fn(() => [{ object: mesh, point: new Vector3(1, 2, 3) }]);
        const context: NeedleContext = {
            mainCamera: {},
            renderer: { domElement: element },
            physics: {
                raycaster: { ray: { origin: new Vector3(4, 5, 6) } },
                raycast,
            },
        };
        const decorator = {
            hoverOn: jest.fn(),
            select: jest.fn(),
        } as unknown as ThreeDecorator;
        const model = { scene: root } as ThreeLoadedModel;
        const detach = attachNeedlePointerEvents(context, model, decorator);

        element.dispatchEvent(new MouseEvent("pointermove", { clientX: 110, clientY: 45 }));
        element.dispatchEvent(new MouseEvent("click", { clientX: 110, clientY: 45 }));

        expect(raycast).toHaveBeenCalledWith(expect.objectContaining({
            screenPoint: { x: 0, y: 0.5 },
            targets: root.children,
            useAcceleratedRaycast: false,
        }));
        expect(decorator.hoverOn).toHaveBeenCalledWith(7, 0);
        expect(decorator.select).toHaveBeenCalledWith(7, 0, [1, 2, 3], [4, 5, 6]);

        detach();
        jest.clearAllMocks();
        element.dispatchEvent(new MouseEvent("click", { clientX: 110, clientY: 45 }));
        expect(decorator.select).not.toHaveBeenCalled();
    });
});
