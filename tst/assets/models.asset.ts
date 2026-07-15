import { jest } from "@jest/globals";
import { BasicBehaveEngine } from "../../src/BasicBehaveEngine/BasicBehaveEngine";
import { disposeThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";
import { BabylonDecorator } from "../../src/decorators/BabylonDecorator";
import { ThreeDecorator } from "../../src/decorators/ThreeDecorator";
import { BabylonScene, loadBabylonWorldFromGlb, NullEngine } from "./babylonAssetHarness";
import { loadModelAssetCases } from "./modelAssetHarness";
import { runGraphAndWait, TestEventBus } from "./sampleAssetHarness";
import { loadThreeWorldFromGlb } from "./threeAssetHarness";
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
        decorator.executeEventQueueTick();
        PHYSICS_NODE_PATHS.forEach((path, nodeIndex) => {
            positionsByNode[nodeIndex].push(readNumbers(decorator, path));
        });
    }
    decorator.pauseEventQueue();
    decorator.clearCustomEventListeners();

    const failures = positionsByNode.flatMap((positions, nodeIndex) => {
        const heights = positions.map((position) => position[1]);
        const minimum = Math.min(...heights);
        const minimumIndex = heights.indexOf(minimum);
        const reboundHeight = Math.max(...heights.slice(minimumIndex + 1));
        const initialPosition = initialPositions[nodeIndex];
        const verticalTravel = Math.max(...heights) - Math.min(...heights);
        const lateralDeflection = Math.max(...positions.map((position) => Math.hypot(
            position[0] - initialPosition[0],
            position[2] - initialPosition[2],
        )));
        return verticalTravel > 0.2 && lateralDeflection > 0.1
            ? []
            : [`${PHYSICS_NODE_PATHS[nodeIndex]}: vertical travel=${verticalTravel.toFixed(3)}, y=${heights[0].toFixed(3)}..${heights[heights.length - 1].toFixed(3)}, min=${minimum.toFixed(3)} at sample ${minimumIndex}, rebound=${(reboundHeight - minimum).toFixed(3)}, lateral deflection=${lateralDeflection.toFixed(3)}`];
    });
    if (failures.length > 0) {
        throw new Error(`PhysicsMath did not produce a collision response for every sphere:\n${failures.join("\n")}`);
    }
}

describe("KHR_interactivity showcase models - Babylon engine", () => {
    it.each(cases)("$entry.name", async (assetCase) => {
        if (assetCase.loadError || !assetCase.graph) {
            throw assetCase.loadError ?? new Error(`${assetCase.entry.name} has no graph`);
        }

        const nullEngine = new NullEngine();
        const scene = new BabylonScene(nullEngine);
        let decorator: BabylonDecorator | undefined;
        try {
            const engine = new BasicBehaveEngine(60, new TestEventBus());
            const world = await loadBabylonWorldFromGlb(assetCase.glbPath, scene);
            decorator = new BabylonDecorator(engine, world, scene);
            await runModelGraph(assetCase.entry.name, decorator, assetCase.graph);
            await verifyModelBehavior(assetCase.entry.name, decorator);
        } finally {
            decorator?.dispose();
            scene.dispose();
            nullEngine.dispose();
        }
    });
});

describe("KHR_interactivity showcase models - Three engine", () => {
    it.each(cases)("$entry.name", async (assetCase) => {
        if (assetCase.loadError || !assetCase.graph) {
            throw assetCase.loadError ?? new Error(`${assetCase.entry.name} has no graph`);
        }

        const model = await loadThreeWorldFromGlb(assetCase.glbPath, new TestEventBus());
        const runtime = getInteractivityRuntime(model);
        if (!runtime) throw new Error("Three model has no interactivity runtime");
        const decorator = runtime.decorator;
        try {
            if (assetCase.entry.name === "Ghost") {
                expect(model.animations.length).toBeGreaterThan(0);
                expect(model.animations.every((clip) => clip.duration > 0 && clip.tracks.length > 0)).toBe(true);
            }
            await runModelGraph(assetCase.entry.name, decorator, assetCase.graph);
            await verifyModelBehavior(assetCase.entry.name, decorator);
        } finally {
            runtime.dispose();
            disposeThreeLoadedModel(model);
        }
    });
});
