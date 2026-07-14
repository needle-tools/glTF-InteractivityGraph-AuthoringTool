import { jest } from "@jest/globals";
import { BasicBehaveEngine } from "../../src/BasicBehaveEngine/BasicBehaveEngine";
import { disposeThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";
import { BabylonDecorator } from "../../src/decorators/BabylonDecorator";
import { ThreeDecorator } from "../../src/decorators/ThreeDecorator";
import { BabylonScene, loadBabylonWorldFromGlb, NullEngine } from "./babylonAssetHarness";
import { loadModelAssetCases } from "./modelAssetHarness";
import { runGraphAndWait, TestEventBus } from "./sampleAssetHarness";
import { loadThreeWorldFromGlb } from "./threeAssetHarness";

jest.setTimeout(30_000);

const cases = loadModelAssetCases();

const PHYSICS_NODE_PATH = "/nodes/3/translation";
const CONSTRUCTION_LIGHT_PATH = "/materials/2/pbrMetallicRoughness/baseColorFactor";

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
    if (name !== "PhysicsMath") {
        await runGraphAndWait(decorator, graph);
        return;
    }

    const initialPosition = readNumbers(decorator, PHYSICS_NODE_PATH);
    decorator.loadBehaveGraph(graph);
    const positions: number[][] = [];
    for (let index = 0; index < 18; index++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        decorator.executeEventQueueTick();
        positions.push(readNumbers(decorator, PHYSICS_NODE_PATH));
    }
    decorator.pauseEventQueue();
    decorator.clearCustomEventListeners();

    const heights = positions.map((position) => position[1]);
    const minimum = Math.min(...heights);
    const minimumIndex = heights.indexOf(minimum);
    const reboundHeight = Math.max(...heights.slice(minimumIndex + 1));
    const lateralDeflection = Math.max(...positions.map((position) => Math.hypot(
        position[0] - initialPosition[0],
        position[2] - initialPosition[2],
    )));
    if (reboundHeight <= minimum + 0.2 || lateralDeflection <= 0.1) {
        throw new Error(
            `PhysicsMath did not produce a box collision response: rebound=${(reboundHeight - minimum).toFixed(3)}, lateral deflection=${lateralDeflection.toFixed(3)}`,
        );
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

        const model = await loadThreeWorldFromGlb(assetCase.glbPath);
        const decorator = new ThreeDecorator(new BasicBehaveEngine(60, new TestEventBus()), model);
        try {
            await runModelGraph(assetCase.entry.name, decorator, assetCase.graph);
            await verifyModelBehavior(assetCase.entry.name, decorator);
        } finally {
            decorator.dispose();
            disposeThreeLoadedModel(model);
        }
    });
});
