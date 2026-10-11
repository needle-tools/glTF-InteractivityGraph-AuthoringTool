import fs from "fs";
import path from "path";
import { validateInteractivityExtension } from "../../src/BasicBehaveEngine/validateInteractivity";
import { loadThreeWorldFromGltf } from "./threeAssetHarness";
import { disposeThreeLoadedModel } from "../../src/integrations/ThreeLoadedModel";
import { getInteractivityRuntime } from "../../src/integrations/InteractivityRuntime";
import { getSampleAssetsRoot, loadAssetCases } from "./sampleAssetHarness";

const root = path.join(getSampleAssetsRoot(), "Tests/Interactivity");
const invalid: Array<Record<string, any>> = JSON.parse(
    fs.readFileSync(path.join(root, "invalid/invalid-index.json"), "utf8"),
);

describe("KHR_interactivity current assets - Three invalid graphs", () => {
    it.each(invalid)("$id: $title", async (entry: any) => {
        const file = path.join(root, entry.name, entry.variants.glTF);
        const gltf = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(() =>
            validateInteractivityExtension(gltf.extensions.KHR_interactivity),
        ).toThrow(/Invalid KHR_interactivity/);
        await expect(loadThreeWorldFromGltf(file)).rejects.toThrow(
            /Invalid KHR_interactivity/,
        );
    });
});

describe("KHR_interactivity current assets - Three valid graph counterparts", () => {
    it.each(
        loadAssetCases().filter((asset) =>
            asset.entry.name.startsWith("graph/"),
        ),
    )("$entry.name", async (asset) => {
        const model = await loadThreeWorldFromGltf(asset.glbPath);
        try {
            expect(getInteractivityRuntime(model)).toBeDefined();
        } finally {
            getInteractivityRuntime(model)?.dispose();
            disposeThreeLoadedModel(model);
        }
    });
});

describe("KHR_interactivity current assets - Three schema validation", () => {
    it.each(loadAssetCases())("$entry.name", (asset) => {
        expect(asset.loadError).toBeUndefined();
        expect(() =>
            validateInteractivityExtension(
                asset.gltf.extensions.KHR_interactivity,
            ),
        ).not.toThrow();
    });
});
