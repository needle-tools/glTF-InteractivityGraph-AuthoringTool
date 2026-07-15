import { BasicBehaveEngine } from "../src/BasicBehaveEngine/BasicBehaveEngine";
import { BabylonDecorator } from "../src/decorators/BabylonDecorator";
import { BabylonScene, NullEngine } from "./assets/babylonAssetHarness";
import { TestEventBus } from "./assets/sampleAssetHarness";
import { Animation, AnimationGroup, FreeCamera, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import { jest } from "@jest/globals";

describe("BabylonDecorator", () => {
    it("does not rotate the active camera pointer by 180 degrees around Y", () => {
        const nullEngine = new NullEngine();
        const scene = new BabylonScene(nullEngine);
        try {
            const camera = new FreeCamera("camera", Vector3.Zero(), scene);
            camera.rotationQuaternion = Quaternion.Identity();
            camera.computeWorldMatrix();
            scene.activeCamera = camera;
            const decorator = new BabylonDecorator(
                new BasicBehaveEngine(60, new TestEventBus()),
                { glTFNodes: [], materials: [], meshes: [], animations: [] },
                scene,
            );

            expect(decorator.getPathValue("/extensions/KHR_interactivity/activeCamera/rotation"))
                .toEqual([0, -0, 0, 1]);
        } finally {
            scene.dispose();
            nullEngine.dispose();
        }
    });

    it("does not throw from animation time pointer getters when an animation slot is absent", () => {
        const nullEngine = new NullEngine();
        const scene = new BabylonScene(nullEngine);
        try {
            const world = {
                glTFNodes: [],
                materials: [],
                meshes: [],
                animations: new Array(1),
            };
            const decorator = new BabylonDecorator(new BasicBehaveEngine(60, new TestEventBus()), world, scene);

            expect(decorator.isValidJsonPtr("/animations/0/extensions/KHR_interactivity/minTime")).toBe(true);
            expect(decorator.isValidJsonPtr("/animations/0/extensions/KHR_interactivity/maxTime")).toBe(true);
            expect(decorator.getPathValue("/animations/0/extensions/KHR_interactivity/minTime")).toEqual([NaN]);
            expect(decorator.getPathValue("/animations/0/extensions/KHR_interactivity/maxTime")).toEqual([NaN]);
        } finally {
            scene.dispose();
            nullEngine.dispose();
        }
    });

    it("uses the animation's frame rate for time pointers", () => {
        const nullEngine = new NullEngine();
        const scene = new BabylonScene(nullEngine);
        try {
            const animation = createAnimationGroup(scene, 24, 12, 36);
            const decorator = new BabylonDecorator(
                new BasicBehaveEngine(60, new TestEventBus()),
                { glTFNodes: [], materials: [], meshes: [], animations: [animation] },
                scene,
            );

            expect(decorator.getPathValue("/animations/0/extensions/KHR_interactivity/minTime")).toEqual([0.5]);
            expect(decorator.getPathValue("/animations/0/extensions/KHR_interactivity/maxTime")).toEqual([1.5]);
        } finally {
            scene.dispose();
            nullEngine.dispose();
        }
    });

    it("keeps an infinite animation range playing without firing its completion callback", () => {
        jest.useFakeTimers();
        const nullEngine = new NullEngine();
        const scene = new BabylonScene(nullEngine);
        const animation = createAnimationGroup(scene, 24, 0, 24);
        const decorator = new BabylonDecorator(
            new BasicBehaveEngine(60, new TestEventBus()),
            { glTFNodes: [], materials: [], meshes: [], animations: [animation] },
            scene,
        );
        const completed = jest.fn();
        try {
            decorator.startAnimation(0, 0, Infinity, 1, completed);
            jest.advanceTimersByTime(10_000);

            expect(completed).not.toHaveBeenCalled();
            expect(decorator.getPathValue("/animations/0/extensions/KHR_interactivity/isPlaying")).toEqual([true]);
        } finally {
            decorator.dispose();
            scene.dispose();
            nullEngine.dispose();
            jest.useRealTimers();
        }
    });

    it("advances animation targets without requiring a scene render loop", () => {
        jest.useFakeTimers();
        const nullEngine = new NullEngine();
        const scene = new BabylonScene(nullEngine);
        const { group, target } = createAnimation(scene, 24, 0, 24);
        const decorator = new BabylonDecorator(
            new BasicBehaveEngine(60, new TestEventBus()),
            { glTFNodes: [target], materials: [], meshes: [], animations: [group] },
            scene,
        );
        try {
            decorator.startAnimation(0, 0, 1, 1, jest.fn());
            jest.advanceTimersByTime(500);

            expect(target.position.x).toBeCloseTo(0.5, 1);
        } finally {
            decorator.dispose();
            scene.dispose();
            nullEngine.dispose();
            jest.useRealTimers();
        }
    });
});

function createAnimationGroup(scene: BabylonScene, fps: number, from: number, to: number): AnimationGroup {
    return createAnimation(scene, fps, from, to).group;
}

function createAnimation(scene: BabylonScene, fps: number, from: number, to: number): {
    group: AnimationGroup;
    target: TransformNode;
} {
    const target = new TransformNode("animated", scene);
    const animation = new Animation("move", "position.x", fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys([
        { frame: from, value: 0 },
        { frame: to, value: 1 },
    ]);
    const group = new AnimationGroup("group", scene);
    group.addTargetedAnimation(animation, target);
    return { group, target };
}
