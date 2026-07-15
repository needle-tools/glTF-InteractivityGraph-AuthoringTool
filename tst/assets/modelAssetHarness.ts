import fs from "fs";
import path from "path";
import { getSampleAssetsRoot } from "./sampleAssetHarness";

interface ModelIndexEntry {
    label: string;
    name: string;
    variants: Partial<Record<ModelVariant, string>>;
}

export type ModelVariant = "glTF-Binary" | "glTF";

export interface ModelAssetCase {
    entry: ModelIndexEntry;
    variant: ModelVariant;
    assetPath: string;
}

const MODEL_VARIANTS: ModelVariant[] = ["glTF-Binary", "glTF"];

export function loadModelAssetCases(): ModelAssetCase[] {
    const root = path.join(getSampleAssetsRoot(), "Models");
    const indexPath = path.join(root, "model-index.json");
    if (!fs.existsSync(indexPath)) {
        throw new Error(`KHR_interactivity model assets not found at ${root}. Set KHR_INTERACTIVITY_SAMPLE_ASSETS to the repo root.`);
    }

    const nameFilter = process.env.KHR_INTERACTIVITY_ASSET_NAME_FILTER;
    const filter = process.env.KHR_INTERACTIVITY_ASSET_FILTER;
    const limit = Number(process.env.KHR_INTERACTIVITY_ASSET_LIMIT ?? "0");
    const entries = JSON.parse(fs.readFileSync(indexPath, "utf8")) as ModelIndexEntry[];

    return entries
        .filter((entry) => !nameFilter || entry.name === nameFilter || `Models/${entry.name}` === nameFilter)
        .filter((entry) => !filter || entry.name.includes(filter) || entry.label.includes(filter))
        .slice(0, limit > 0 ? limit : undefined)
        .flatMap((entry): ModelAssetCase[] => MODEL_VARIANTS.flatMap((variant): ModelAssetCase[] => {
            const fileName = entry.variants[variant];
            if (!fileName) return [];
            return [{ entry, variant, assetPath: path.join(root, entry.name, variant, fileName) }];
        }));
}
