import fs from "fs";
import path from "path";
import { IInteractivityGraph } from "../../src/BasicBehaveEngine/types/InteractivityGraph";
import { getSampleAssetsRoot, readGlbJson } from "./sampleAssetHarness";

interface ModelIndexEntry {
    label: string;
    name: string;
    variants: { "glTF-Binary": string };
}

export interface ModelAssetCase {
    entry: ModelIndexEntry;
    glbPath: string;
    graph?: IInteractivityGraph;
    loadError?: Error;
}

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
        .map((entry) => {
            const glbPath = path.join(root, entry.name, "glTF-Binary", entry.variants["glTF-Binary"]);
            try {
                const gltf = readGlbJson(glbPath);
                const interactivity = gltf.extensions?.KHR_interactivity;
                const graph = interactivity?.graphs?.[interactivity.graph ?? 0] as IInteractivityGraph | undefined;
                if (!graph) {
                    throw new Error(`No KHR_interactivity graph found in ${glbPath}`);
                }
                return { entry, glbPath, graph };
            } catch (error) {
                return {
                    entry,
                    glbPath,
                    loadError: error instanceof Error ? error : new Error(String(error)),
                };
            }
        });
}
