import fs from "node:fs/promises";
import path from "node:path";
const packageRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const cache = path.join(packageRoot, ".cache");
const packed = JSON.parse(
    await fs.readFile(path.join(cache, "packed-consumer.json"), "utf8"),
);
const coverage = JSON.parse(
    await fs.readFile(path.join(cache, "coverage.json"), "utf8"),
);
const conformance = [],
    xr = [];
async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.name === "conformance-results.json")
            conformance.push(JSON.parse(await fs.readFile(file, "utf8")));
        else if (entry.name === "xr-results.json")
            xr.push(...JSON.parse(await fs.readFile(file, "utf8")));
    }
}
await walk(path.join(packageRoot, "test-results"));
const runtimes = [];
for (const result of conformance) {
    const rows = result.results;
    const operations = new Set(rows.flatMap((r) => r.executedOperations ?? []));
    runtimes.push({
        id: rows[0]?.runtime,
        assets: rows.length,
        assertions: rows.reduce((n, r) => n + (r.assertionCount ?? 0), 0),
        rejections: rows.filter((r) => r.rejected).length,
        observedOperations: Object.keys(coverage.operations).filter((op) =>
            operations.has(op),
        ).length,
        failures: rows.filter((r) => r.status !== "passed"),
    });
}
const expected = (
    await Promise.all(
        ["three", "needle"].map(async (kind) =>
            JSON.parse(
                await fs.readFile(
                    path.join(cache, `${kind}-matrix-pages/manifest.json`),
                    "utf8",
                ),
            ),
        ),
    )
).flatMap((m) => m.pages);
const needle = expected.filter((e) => e.runtimeShape);
const corpusExpected = [
    expected.filter((e) => !e.runtimeShape).at(-1),
    ...needle.filter((e) => e.runtimeShape === "module"),
];
const xrExpected = [needle.filter((e) => e.runtimeShape === "module").at(-1)];
const expectedAssetCount =
    coverage.validAssets - 1 + coverage.invalidAssets + coverage.modelVariants; // InterGlb is one paired case
const incomplete = corpusExpected
    .filter(
        (e) =>
            !runtimes.some(
                (r) => r.id === e.id && r.assets === expectedAssetCount,
            ),
    )
    .map((e) => e.id);
const incompleteXR = xrExpected
    .filter(
        (e) =>
            xr.filter((r) => r.runtime === e.id && r.status === "passed")
                .length !== 4,
    )
    .map((e) => e.id);
const report = {
    date: new Date().toISOString(),
    revision: packed.revision,
    sourceTreeSha256: packed.sourceTreeSha256,
    artifacts: packed.artifacts,
    assetsRevision: coverage.assetsRevision,
    policy: {
        smoke: expected.map((e) => e.id),
        corpus: corpusExpected.map((e) => e.id),
        xr: xrExpected.map((e) => e.id),
    },
    coverage,
    threeConsumers: packed.threeConsumers,
    consumers: packed.needleConsumers?.map(({ version, three }) => ({
        version,
        three,
    })),
    runtimes: runtimes.sort((a, b) => a.id.localeCompare(b.id)),
    xr,
    incomplete,
    incompleteXR,
    failures: [
        ...runtimes.flatMap((r) => r.failures),
        ...xr.filter((r) => r.status !== "passed"),
    ],
};
await fs.writeFile(
    path.join(cache, "matrix-report.json"),
    JSON.stringify(report, null, 2),
);
const lines = [
    "# Integration matrix verification",
    "",
    `Source: ${report.revision} (working source tree ${report.sourceTreeSha256}).`,
    "",
    `Assets: ${report.assetsRevision}. ${coverage.coveredCoreOperationCount}/${coverage.coreOperationCount} core operation names present; ${coverage.invalidAssets} invalid fixtures; ${coverage.manualAssertions} desktop interaction assertions.`,
    "",
    "| Runtime | Assets | Assertions | Invalid rejections | Observed operation hooks | Failures |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.runtimes.map(
        (r) =>
            `| ${r.id} | ${r.assets} | ${r.assertions} | ${r.rejections} | ${r.observedOperations} | ${r.failures.length} |`,
    ),
    "",
    `IWER: ${xr.filter((r) => r.status === "passed").length}/${xrExpected.length * 4} AR/VR controller/hand profiles passed on latest Needle.`,
    "",
    `Incomplete asset runtimes: ${incomplete.join(", ") || "none"}. Incomplete XR runtimes: ${incompleteXR.join(", ") || "none"}.`,
    "",
    "This verifies the current fixture corpus and Chromium emulation, not exhaustive spec coverage or physical XR devices. Some event nodes do not call the operation hook; hook counts are diagnostic rather than a completeness claim.",
    "",
    "Artifacts:",
    "",
    ...report.artifacts.map(
        (a) => `- ${a.name}@${a.version}: SHA256 ${a.sha256} (${a.tarball})`,
    ),
];
await fs.writeFile(
    path.join(cache, "matrix-report.md"),
    lines.join("\n") + "\n",
);
console.log(
    `${runtimes.length}/${corpusExpected.length} asset runtimes, ${xr.length}/${xrExpected.length * 4} XR profiles, ${report.failures.length} failures`,
);
if (incomplete.length || incompleteXR.length || report.failures.length)
    process.exitCode = 1;
