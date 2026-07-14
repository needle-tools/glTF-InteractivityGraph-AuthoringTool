import { AnimationClip, BufferGeometry, Group, MathUtils, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, Texture } from "three";
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
            scene: 0,
            scenes: [{ nodes: [0] }],
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

    it("maps repeated mesh clones by glTF hierarchy instead of shared loader associations", () => {
        const scene = new Group();
        const first = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
        const second = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
        scene.add(first, second);
        const sharedAssociation = { meshes: 0, primitives: 0, nodes: 1 };
        const result = {
            scene,
            scenes: [scene],
            animations: [],
            cameras: [],
            parser: {
                json: {
                    scene: 0,
                    scenes: [{ nodes: [0, 1] }],
                    nodes: [{ mesh: 0 }, { mesh: 0 }],
                    meshes: [{ primitives: [{}] }],
                },
                associations: new Map([[first, sharedAssociation], [second, sharedAssociation]]),
            },
        } as unknown as GLTF;

        const model = buildThreeLoadedModel(result);
        const decorator = new ThreeDecorator(new BasicBehaveEngine(60, new DOMEventBus()), model);
        try {
            decorator.setPathValue("/nodes/0/translation", [1, 2, 3]);
            expect(first.position.toArray()).toEqual([1, 2, 3]);
            expect(second.position.toArray()).toEqual([0, 0, 0]);
            expect(first.userData.gltfNodeIndex).toBe(0);
            expect(second.userData.gltfNodeIndex).toBe(1);
        } finally {
            decorator.dispose();
            disposeThreeLoadedModel(model);
        }
    });

    it("uses exact object references and supports nodes outside the active scene", () => {
        const scene = new Group();
        const activeNode = new Group();
        const childNode = new Group();
        const inactiveNode = new Group();
        inactiveNode.add(new Mesh(new BufferGeometry(), new MeshStandardMaterial()));
        const nodeWithoutMesh = new Group();
        activeNode.add(childNode);
        scene.add(activeNode);
        const result = {
            scene,
            scenes: [scene],
            animations: [new AnimationClip("idle", 1, [])],
            cameras: [],
            parser: {
                json: {
                    scene: 0,
                    scenes: [{ nodes: [0] }],
                    nodes: [{ children: [1], mesh: 0 }, {}, { mesh: 1 }, {}],
                    meshes: [{ primitives: [{ material: 0 }] }, { primitives: [{}] }],
                    materials: [{}],
                    animations: [{}],
                },
                associations: new Map(),
            },
        } as unknown as GLTF;

        const model = buildThreeLoadedModel(result, [], [activeNode, childNode, inactiveNode, nodeWithoutMesh]);
        const decorator = new ThreeDecorator(new BasicBehaveEngine(60, new DOMEventBus()), model);
        try {
            expect(decorator.getPathValue("/scenes/0/nodes/0")).toEqual(["/nodes/0"]);
            expect(decorator.getPathValue("/nodes/0/children/0")).toEqual(["/nodes/1"]);
            expect(decorator.getPathValue("/nodes/0/mesh")).toEqual(["/meshes/0"]);
            expect(decorator.getPathValue("/meshes/0/primitives/0/material")).toEqual(["/materials/0"]);
            expect(decorator.getPathValue("/animations/0")).toEqual(["/animations/0"]);
            expect(decorator.isValidJsonPtr("/animations/0/")).toBe(false);

            expect(decorator.getPathValue("/nodes/2/weights.length")).toEqual([0]);
            expect(decorator.isValidJsonPtr("/nodes/3/weights.length")).toBe(false);
            expect(decorator.isValidJsonPtr("/nodes/0/name")).toBe(false);

            decorator.setPathValue("/nodes/2/translation", [4, 5, 6]);
            expect(inactiveNode.position.toArray()).toEqual([4, 5, 6]);
        } finally {
            decorator.dispose();
            disposeThreeLoadedModel(model);
        }
    });

    it("updates physical material and texture pointers through concrete Three bindings", () => {
        const scene = new Group();
        const material = new MeshPhysicalMaterial();
        material.map = new Texture();
        const mesh = new Mesh(new BufferGeometry(), material);
        scene.add(mesh);
        const result = {
            scene,
            scenes: [scene],
            animations: [],
            cameras: [],
            parser: {
                json: {
                    scene: 0,
                    scenes: [{ nodes: [0] }],
                    nodes: [{ mesh: 0 }],
                    meshes: [{ primitives: [{ material: 0 }] }],
                    materials: [{
                        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
                        extensions: { KHR_materials_ior: { ior: 1.5 } },
                    }],
                },
                associations: new Map<object, { materials?: number; meshes?: number; primitives?: number; nodes?: number }>([
                    [material, { materials: 0 }],
                    [mesh, { meshes: 0, primitives: 0, nodes: 0 }],
                ]),
            },
        } as unknown as GLTF;

        const model = buildThreeLoadedModel(result);
        const decorator = new ThreeDecorator(new BasicBehaveEngine(60, new DOMEventBus()), model);
        try {
            const transform = "/materials/0/pbrMetallicRoughness/baseColorTexture/extensions/KHR_texture_transform";
            decorator.setPathValue("/materials/0/extensions/KHR_materials_ior/ior", [2.1]);
            decorator.setPathValue(`${transform}/offset`, [0.25, 0.75]);
            decorator.setPathValue("/materials/0/pbrMetallicRoughness/baseColorTexture/texCoord", [2]);

            expect(material.ior).toBe(2.1);
            expect(material.map.offset.toArray()).toEqual([0.25, 0.75]);
            expect(material.map.channel).toBe(2);
            expect(decorator.isValidJsonPtr("/materials/0/extensions/KHR_materials_clearcoat/clearcoatFactor")).toBe(false);
        } finally {
            decorator.dispose();
            disposeThreeLoadedModel(model);
        }
    });

    it("implements glTF and active camera pointers on Three cameras", () => {
        const scene = new Group();
        scene.position.set(1, 0, 0);
        const camera = new PerspectiveCamera(45, 1.5, 0.1, 100);
        camera.position.set(2, 3, 4);
        scene.add(camera);
        const result = {
            scene,
            scenes: [scene],
            animations: [],
            cameras: [camera],
            parser: {
                json: {
                    scene: 0,
                    scenes: [{ nodes: [0] }],
                    nodes: [{ camera: 0 }],
                    cameras: [{ perspective: { aspectRatio: 1.5, yfov: MathUtils.degToRad(45), znear: 0.1, zfar: 100 } }],
                },
                associations: new Map(),
            },
        } as unknown as GLTF;

        const model = buildThreeLoadedModel(result);
        const decorator = new ThreeDecorator(new BasicBehaveEngine(60, new DOMEventBus()), model);
        try {
            decorator.setCamera(camera);
            decorator.setPathValue("/cameras/0/perspective/yfov", [Math.PI / 3]);
            decorator.setPathValue("/cameras/0/perspective/aspectRatio", [2]);

            expect(camera.fov).toBeCloseTo(60);
            expect(camera.aspect).toBe(2);
            expect(decorator.getPathValue("/extensions/KHR_interactivity/activeCamera/position")).toEqual([3, 3, 4]);
            expect(decorator.getPathValue("/extensions/KHR_interactivity/activeCamera/perspective/yfov")).toEqual([Math.PI / 3]);
            expect(decorator.isReadOnly("/extensions/KHR_interactivity/activeCamera/position")).toBe(true);
        } finally {
            decorator.dispose();
            disposeThreeLoadedModel(model);
        }
    });
});
