import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
);
const manifest = JSON.parse(
    fs.readFileSync(
        path.join(packageRoot, ".cache/assets-manifest.json"),
        "utf8",
    ),
);
const source = fs.readFileSync(
    path.join(
        packageRoot,
        "../../src/BasicBehaveEngine/generated/interactivitySchemas.ts",
    ),
    "utf8",
);
const schemas = JSON.parse(
    source
        .slice(
            source.indexOf(
                "= {",
                source.indexOf("export const OPERATION_SCHEMAS"),
            ) + 2,
        )
        .trim()
        .replace(/;$/, ""),
);
const covered = new Map();
for (const asset of [...manifest.cases, ...manifest.models]) {
    const bytes = fs.readFileSync(asset.url.slice("/__rawfs".length));
    const gltf = JSON.parse(
        bytes.readUInt32LE(0) === 0x46546c67
            ? bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()
            : bytes.toString(),
    );
    const extension = gltf.extensions?.KHR_interactivity;
    const graph = extension?.graphs?.[extension.graph ?? 0];
    for (const node of graph?.nodes ?? []) {
        const declaration = graph.declarations[node.declaration];
        if (declaration.extension) continue;
        const assets = covered.get(declaration.op) ?? new Set();
        assets.add(asset.name);
        covered.set(declaration.op, assets);
    }
}
const core = Object.entries(schemas)
    .filter(([, schema]) => !schema.extension)
    .map(([op]) => op)
    .sort();
const report = {
    assetsRevision: manifest.revision,
    coreOperationCount: core.length,
    coveredCoreOperationCount: core.filter((op) => covered.has(op)).length,
    missingCoreOperations: core.filter((op) => !covered.has(op)),
    operations: Object.fromEntries(
        core.map((op) => [op, [...(covered.get(op) ?? [])].sort()]),
    ),
    validAssets: manifest.cases.length,
    invalidAssets: manifest.invalid.length,
    modelVariants: manifest.models.length,
    manualAssertions: manifest.cases
        .filter((a) =>
            a.metadata.tests.some((t) => t.requiredInteractions?.length),
        )
        .reduce(
            (sum, a) =>
                sum +
                a.metadata.tests.reduce((n, t) => n + t.subTests.length, 0),
            0,
        ),
    scope: "Operation presence in the executed default graphs. This does not establish exhaustive parameter, timing, pointer, optional-extension, device or browser coverage.",
};
fs.writeFileSync(
    path.join(packageRoot, ".cache/coverage.json"),
    JSON.stringify(report, null, 2),
);
console.log(
    `${report.coveredCoreOperationCount}/${report.coreOperationCount} core operations appear in current assets; missing: ${report.missingCoreOperations.join(", ") || "none"}`,
);
