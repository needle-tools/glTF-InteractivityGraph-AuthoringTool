import { jest } from "@jest/globals";
import { BasicBehaveEngine } from "../../src/BasicBehaveEngine/BasicBehaveEngine";
import { BabylonDecorator } from "../../src/decorators/BabylonDecorator";
import { BabylonScene, loadBabylonWorldFromGlb, NullEngine } from "./babylonAssetHarness";
import { ThreeDecorator } from "../../src/decorators/ThreeDecorator";
import { disposeThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";
import { createGlTFObjectModelFromGltf, GlTFObjectModelDecorator } from "../../src/objectModel/glTFObjectModel";
import { loadThreeWorldFromGlb } from "./threeAssetHarness";
import { getInteractivityRuntime, type InteractivityRuntime } from "../../src/integrations/InteractivityRuntime";
import {
    assertAssetSubTest,
    formatError,
    getAssetSubTests,
    loadAssetCases,
    runGraphAndWait,
    TestEventBus,
} from "./sampleAssetHarness";

jest.setTimeout(30_000);

const cases = loadAssetCases({ interGlb: "exclude" });

describe("KHR_interactivity sample assets - Babylon engine", () => {
    if (cases.length === 0) {
        it.skip("has no matching single-file assets", () => undefined);
        return;
    }

    describe.each(cases)("$entry.name", (assetCase) => {
        const subTests = getAssetSubTests(assetCase.metadata);
        let variables: BasicBehaveEngine["variables"] = [];
        let runError: Error | undefined;

        beforeAll(async () => {
            if (assetCase.loadError) {
                runError = assetCase.loadError;
                return;
            }

            const nullEngine = new NullEngine();
            const scene = new BabylonScene(nullEngine);
            try {
                const eventBus = new TestEventBus();
                const engine = new BasicBehaveEngine(60, eventBus);
                const world = await loadBabylonWorldFromGlb(assetCase.glbPath, scene);
                const decorator = new BabylonDecorator(engine, world, scene);

                await runGraphAndWait(decorator, assetCase.graph);
                variables = engine.variables;
            } catch (error) {
                runError = error instanceof Error ? error : new Error(String(error));
            } finally {
                scene.dispose();
                nullEngine.dispose();
            }
        });

        it.each(subTests)("$displayName", ({ subTest }) => {
            if (runError) {
                throw new Error(`${assetCase.entry.name} did not load or execute, so all ${subTests.length} subtest(s) fail:\n${formatError(runError)}`);
            }

            assertAssetSubTest(assetCase.entry.name, variables, subTest);
        });
    });
});

describe("KHR_interactivity sample assets - Three engine", () => {
    if (cases.length === 0) {
        it.skip("has no matching single-file assets", () => undefined);
        return;
    }

    describe.each(cases)("$entry.name", (assetCase) => {
        const subTests = getAssetSubTests(assetCase.metadata);
        let variables: BasicBehaveEngine["variables"] = [];
        let runError: Error | undefined;

        beforeAll(async () => {
            if (assetCase.loadError) {
                runError = assetCase.loadError;
                return;
            }

            let model;
            let runtime: InteractivityRuntime | undefined;
            try {
                model = await loadThreeWorldFromGlb(assetCase.glbPath, new TestEventBus());
                runtime = getInteractivityRuntime(model);
                if (!runtime) throw new Error("Three model has no interactivity runtime");
                const engine = runtime.engine;
                const decorator = runtime.decorator;
                if (assetCase.entry.name === "pointer/set_and_get") {
                    assertThreePointerInventory(assetCase.gltf, decorator);
                }
                await runGraphAndWait(decorator, assetCase.graph);
                variables = engine.variables;
            } catch (error) {
                runError = error instanceof Error ? error : new Error(String(error));
            } finally {
                runtime?.dispose();
                if (model) {
                    disposeThreeLoadedModel(model);
                }
            }
        });

        it.each(subTests)("$displayName", ({ subTest }) => {
            if (runError) {
                throw new Error(`${assetCase.entry.name} did not load or execute, so all ${subTests.length} subtest(s) fail:\n${formatError(runError)}`);
            }
            assertAssetSubTest(assetCase.entry.name, variables, subTest);
        });
    });
});

function assertThreePointerInventory(gltf: any, decorator: ThreeDecorator): void {
    const expected = new GlTFObjectModelDecorator(
        new BasicBehaveEngine(60, new TestEventBus()),
        createGlTFObjectModelFromGltf(gltf),
    );
    try {
        const implemented = new Set(decorator.getRegisteredJsonPointers());
        const expectedPointers = new Set(expected.getRegisteredJsonPointers());
        const missing = [...expectedPointers].filter((pointer) => !implemented.has(pointer));
        if (missing.length > 0) {
            throw new Error(`Three does not directly implement ${missing.length} pointer(s):\n${missing.join("\n")}`);
        }
        const unexpected = [...implemented].filter((pointer) => !expectedPointers.has(pointer));
        if (unexpected.length > 0) {
            throw new Error(`Three incorrectly exposes ${unexpected.length} pointer(s):\n${unexpected.join("\n")}`);
        }
    } finally {
        expected.dispose();
    }
}
