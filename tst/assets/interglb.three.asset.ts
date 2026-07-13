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

jest.setTimeout(30_000);

const describeIfEnabled = shouldRunInterGlbSuite() ? describe : describe.skip;

describeIfEnabled("KHR_interactivity InterGlb paired assets - Three engine", () => {
    const state = createInterGlbRunState();

    beforeAll(async () => {
        const eventBus = new TestEventBus();
        const models: ThreeLoadedModel[] = [];
        const decorators: ThreeDecorator[] = [];
        try {
            const engines = interGlbPairCases.map(() => new BasicBehaveEngine(60, eventBus));
            models.push(...await Promise.all(interGlbPairCases.map((assetCase) => loadThreeWorldFromGlb(assetCase.glbPath))));
            decorators.push(...interGlbPairCases.map((_assetCase, index) => new ThreeDecorator(engines[index], models[index])));
            await runInterGlbPair(state, engines, decorators);
        } finally {
            decorators.forEach((decorator) => decorator.dispose());
            models.forEach(disposeThreeLoadedModel);
        }
    });

    assertInterGlbPairSubTests(state);
});
