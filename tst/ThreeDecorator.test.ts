import { BufferGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BasicBehaveEngine } from "../src/BasicBehaveEngine/BasicBehaveEngine";
import { DOMEventBus } from "../src/BasicBehaveEngine/eventBuses/DOMEventBus";
import { buildThreeLoadedModel, disposeThreeLoadedModel } from "../src/components/engineViews/threeLoadedModel";
import { ThreeDecorator } from "../src/decorators/ThreeDecorator";

describe("ThreeDecorator", () => {
    it("maps extension state and live pointers onto loaded Three objects", () => {
        const scene = new Group();
        const node = new Group();
        const material = new MeshStandardMaterial();
        const mesh = new Mesh(new BufferGeometry(), material);
        mesh.morphTargetInfluences = [0.1, 0.2];
        node.add(mesh);
        scene.add(node);

        const gltf = {
            nodes: [{
                mesh: 0,
                weights: [0.6, 0.2],
                extensions: {
                    KHR_node_visibility: { visible: false },
                    KHR_node_selectability: { selectable: false },
                    KHR_node_hoverability: { hoverable: false },
                },
            }],
            meshes: [{ weights: [0.1, 0.2], primitives: [{ targets: [{}, {}] }] }],
            materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        };
        const result = {
            scene,
            scenes: [scene],
            animations: [],
            cameras: [],
            asset: {},
            parser: {
                json: gltf,
                associations: new Map<object, { nodes?: number; materials?: number } | undefined>([
                    [node, { nodes: 0 }],
                    [material, { materials: 0 }],
                    [new MeshStandardMaterial(), undefined],
                ]),
            },
            userData: {},
        } as unknown as GLTF;

        const model = buildThreeLoadedModel(result);
        const decorator = new ThreeDecorator(new BasicBehaveEngine(60, new DOMEventBus()), model);
        try {
            expect(node.visible).toBe(false);
            expect(node.userData.selectable).toBe(false);
            expect(node.userData.hoverable).toBe(false);
            expect(decorator.getPathValue("/nodes/0/weights/0")).toEqual([0.6]);

            decorator.setPathValue("/nodes/0/extensions/KHR_node_visibility/visible", [true]);
            decorator.setPathValue("/nodes/0/weights/0", [0.9]);
            decorator.setPathValue("/materials/0/pbrMetallicRoughness/baseColorFactor", [0.25, 0.5, 0.75, 0.8]);

            expect(node.visible).toBe(true);
            expect(mesh.morphTargetInfluences).toEqual([0.9, 0.2]);
            expect(material.color.toArray()).toEqual([0.25, 0.5, 0.75]);
            expect(material.opacity).toBe(0.8);
        } finally {
            decorator.dispose();
            disposeThreeLoadedModel(model);
        }
    });
});
