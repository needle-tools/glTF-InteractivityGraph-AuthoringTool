import { jest } from "@jest/globals";
import { BasicBehaveEngine } from "../../src/BasicBehaveEngine/BasicBehaveEngine";
import { disposeThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";
import { BabylonDecorator } from "../../src/decorators/BabylonDecorator";
import { ThreeDecorator } from "../../src/decorators/ThreeDecorator";
import { BabylonScene, loadBabylonWorldFromGltf, NullEngine } from "./babylonAssetHarness";
import { loadModelAssetCases } from "./modelAssetHarness";
import { runGraphAndWait, TestEventBus } from "./sampleAssetHarness";
import { loadThreeWorldFromGltf } from "./threeAssetHarness";
import { getInteractivityRuntime } from "../../src/integrations/InteractivityRuntime";

jest.setTimeout(30_000);

const cases = loadModelAssetCases();

const PHYSICS_NODE_PATHS = [
    "/nodes/3/translation",
    "/nodes/4/translation",
    "/nodes/5/translation",
] as const;
const CONSTRUCTION_LIGHT_PATH = "/materials/2/pbrMetallicRoughness/baseColorFactor";
const BOW_AIM_ROTATION_PATH = "/nodes/4/rotation";
const BOW_ARROW_TRANSLATION_PATH = "/nodes/11/translation";
const BOW_ARROW_VISIBLE_PATH = "/nodes/12/extensions/KHR_node_visibility/visible";

function readNumbers(decorator: BabylonDecorator | ThreeDecorator, path: string): number[] {
    const value = decorator.getPathValue(path);
    if (!Array.isArray(value) || value.some((component) => typeof component !== "number")) {
        throw new Error(`Expected numeric value at ${path}, got ${JSON.stringify(value)}`);
    }
    return value;
}

async function verifyModelBehavior(
    name: string,
    decorator: BabylonDecorator | ThreeDecorator,
): Promise<void> {
    if (name === "ConstructionSite") {
        decorator.select(6, 0, undefined, undefined);
        decorator.executeEventQueueTick();
        expect(readNumbers(decorator, CONSTRUCTION_LIGHT_PATH)).toEqual(
            expect.arrayContaining([
                expect.closeTo(0.9921569, 5),
                expect.closeTo(0.6892083, 5),
                expect.closeTo(0, 5),
                expect.closeTo(1, 5),
            ]),
        );
    }
}

async function runModelGraph(
    name: string,
    decorator: BabylonDecorator | ThreeDecorator,
    graph: any,
): Promise<void> {
    if (name === "BowShooting") {
        const initialAimRotation = readNumbers(decorator, BOW_AIM_ROTATION_PATH);
        decorator.loadBehaveGraph(graph);
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(readNumbers(decorator, BOW_AIM_ROTATION_PATH)).not.toEqual(initialAimRotation);

        decorator.select(16, 0, [0, 0, 0], [0, 1, 0]);
        await new Promise((resolve) => setTimeout(resolve, 80));
        decorator.select(16, 0, [0, 0, 0], [0, 1, 0]);

        const initialArrowPosition = readNumbers(decorator, BOW_ARROW_TRANSLATION_PATH);
        const positions: number[][] = [];
        for (let index = 0; index < 10; index++) {
            await new Promise((resolve) => setTimeout(resolve, 40));
            positions.push(readNumbers(decorator, BOW_ARROW_TRANSLATION_PATH));
        }
        expect(decorator.getPathValue(BOW_ARROW_VISIBLE_PATH)).toEqual([true]);
        expect(positions.some((position) => position.some(
            (value, component) => Math.abs(value - initialArrowPosition[component]) > 0.01,
        ))).toBe(true);
        expect(positions.flat().every(Number.isFinite)).toBe(true);
        decorator.pauseEventQueue();
        decorator.clearCustomEventListeners();
        return;
    }

    if (name === "Ghost") {
        const animatedPath = "/nodes/6/translation";
        const initialPosition = readNumbers(decorator, animatedPath);
        decorator.loadBehaveGraph(graph);
        decorator.hoverOn(4, 0);
        decorator.executeEventQueueTick();
        await new Promise((resolve) => setTimeout(resolve, 300));
        decorator.executeEventQueueTick();
        expect(readNumbers(decorator, animatedPath)).not.toEqual(initialPosition);
        decorator.hoverOn(undefined, 0);
        decorator.pauseEventQueue();
        decorator.clearCustomEventListeners();
        return;
    }

    if (name !== "PhysicsMath") {
        await runGraphAndWait(decorator, graph);
        return;
    }

    const initialPositions = PHYSICS_NODE_PATHS.map((path) => readNumbers(decorator, path));
    decorator.loadBehaveGraph(graph);
    const positionsByNode = PHYSICS_NODE_PATHS.map(() => [] as number[][]);
    for (let index = 0; index < 90; index++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        PHYSICS_NODE_PATHS.forEach((path, nodeIndex) => {
            positionsByNode[nodeIndex].push(readNumbers(decorator, path));
        });
    }
    decorator.pauseEventQueue();
    decorator.clearCustomEventListeners();

    const failures = positionsByNode.flatMap((positions, nodeIndex) => {
        const heights = positions.map((position) => position[1]);
        const initialPosition = initialPositions[nodeIndex];
        const lateralDeflection = Math.max(...positions.map((position) => Math.hypot(
            position[0] - initialPosition[0],
            position[2] - initialPosition[2],
        )));
        const reboundIndex = positions.findIndex((position, index) => {
            if (index < 2) return false;
            const previousDrop = heights[index - 1] - heights[index - 2];
            const upwardStep = position[1] - heights[index - 1];
            const horizontalTravel = Math.hypot(
                position[0] - initialPosition[0],
                position[2] - initialPosition[2],
            );
            return previousDrop < -0.01 && upwardStep > 0.05 && horizontalTravel > 0.02;
        });
        return reboundIndex >= 0 && lateralDeflection > 0.1
            ? []
            : [`${PHYSICS_NODE_PATHS[nodeIndex]}: no collision rebound found, y=${heights[0].toFixed(3)}..${heights[heights.length - 1].toFixed(3)}, lateral deflection=${lateralDeflection.toFixed(3)}`];
    });
    if (failures.length > 0) {
        throw new Error(`PhysicsMath did not produce a collision response for every sphere:\n${failures.join("\n")}`);
    }
}

describe("KHR_interactivity showcase models - Babylon engine", () => {
    it.each(cases)("$entry.name ($variant)", async (assetCase) => {
        const nullEngine = new NullEngine();
        const scene = new BabylonScene(nullEngine);
        let decorator: BabylonDecorator | undefined;
        try {
            const engine = new BasicBehaveEngine(60, new TestEventBus());
            const world = await loadBabylonWorldFromGltf(assetCase.assetPath, scene);
            decorator = new BabylonDecorator(engine, world, scene);
            const graph = decorator.extractBehaveGraphFromScene();
            if (!graph) throw new Error(`${assetCase.entry.name} (${assetCase.variant}) loader did not expose its embedded graph`);
            await runModelGraph(assetCase.entry.name, decorator, graph);
            await verifyModelBehavior(assetCase.entry.name, decorator);
        } finally {
            decorator?.dispose();
            scene.dispose();
            nullEngine.dispose();
        }
    });
});

describe("KHR_interactivity showcase models - Three engine", () => {
    it.each(cases)("$entry.name ($variant)", async (assetCase) => {
        const model = await loadThreeWorldFromGltf(assetCase.assetPath, new TestEventBus());
        const runtime = getInteractivityRuntime(model);
        if (!runtime) throw new Error("Three model has no interactivity runtime");
        const decorator = runtime.decorator;
        try {
            if (assetCase.entry.name === "Ghost") {
                expect(model.animations.length).toBeGreaterThan(0);
                expect(model.animations.every((clip) => clip.duration > 0 && clip.tracks.length > 0)).toBe(true);
            }
            const graph = runtime.graph;
            if (!graph) throw new Error(`${assetCase.entry.name} (${assetCase.variant}) loader did not expose its embedded graph`);
            await runModelGraph(assetCase.entry.name, decorator, graph);
            await verifyModelBehavior(assetCase.entry.name, decorator);
        } finally {
            runtime.dispose();
            disposeThreeLoadedModel(model);
        }
    });
});
