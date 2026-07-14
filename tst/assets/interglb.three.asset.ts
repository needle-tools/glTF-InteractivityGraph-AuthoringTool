import { jest } from "@jest/globals";
import { BasicBehaveEngine } from "../../src/BasicBehaveEngine/BasicBehaveEngine";
import { ThreeDecorator } from "../../src/decorators/ThreeDecorator";
import { disposeThreeLoadedModel, ThreeLoadedModel } from "../../src/components/engineViews/threeLoadedModel";
import {
    assertInterGlbPairSubTests,
    createInterGlbRunState,
    interGlbPairCases,
    runInterGlbPair,
    shouldRunInterGlbSuite,
} from "./interglbHarness";
import { TestEventBus } from "./sampleAssetHarness";
import { loadThreeWorldFromGlb } from "./threeAssetHarness";
import { getInteractivityRuntime, type InteractivityRuntime } from "../../src/integrations/InteractivityRuntime";

jest.setTimeout(30_000);

const describeIfEnabled = shouldRunInterGlbSuite() ? describe : describe.skip;

describeIfEnabled("KHR_interactivity InterGlb paired assets - Three engine", () => {
    const state = createInterGlbRunState();

    beforeAll(async () => {
        const eventBus = new TestEventBus();
        const models: ThreeLoadedModel[] = [];
        const decorators: ThreeDecorator[] = [];
        const runtimes: InteractivityRuntime[] = [];
        try {
            models.push(...await Promise.all(interGlbPairCases.map((assetCase) => loadThreeWorldFromGlb(assetCase.glbPath, eventBus))));
            const loadedRuntimes = models.map(getInteractivityRuntime);
            if (loadedRuntimes.some((runtime) => !runtime)) throw new Error("Three model has no interactivity runtime");
            runtimes.push(...loadedRuntimes as InteractivityRuntime[]);
            const engines = runtimes.map((runtime) => runtime.engine);
            decorators.push(...runtimes.map((runtime) => runtime.decorator));
            await runInterGlbPair(state, engines, decorators);
        } finally {
            runtimes.forEach((runtime) => runtime.dispose());
            models.forEach(disposeThreeLoadedModel);
        }
    });

    assertInterGlbPairSubTests(state);
});
