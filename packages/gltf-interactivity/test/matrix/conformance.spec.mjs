import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
const packageRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const manifests = await Promise.all(
    ["three", "needle"].map(async (kind) =>
        JSON.parse(
            await fs.readFile(
                path.join(
                    packageRoot,
                    `.cache/${kind}-matrix-pages/manifest.json`,
                ),
                "utf8",
            ),
        ),
    ),
);
const latestThree = manifests[0].pages.at(-1);
// Full fixtures exercise behavior once per representative backend, while
// matrix.spec checks loading/rendering across the milestone versions/shapes.
const representativePages = [
    latestThree,
    ...manifests[1].pages.filter((entry) => entry.runtimeShape === "module"),
];
const pages = (process.env.CONFORMANCE_RUNTIME_FILTER
    ? manifests.flatMap((m) => m.pages)
    : representativePages)
    .filter(
        (entry) =>
            !process.env.CONFORMANCE_RUNTIME_FILTER ||
            entry.id.includes(process.env.CONFORMANCE_RUNTIME_FILTER),
    );
if (!pages.length)
    throw new Error(
        "No matrix pages. Run the pack-consumer and cache-pages scripts first.",
    );
for (const entry of pages)
    test(`${entry.id}: complete current asset corpus`, async ({
        context,
    }, testInfo) => {
        test.setTimeout(900_000);
        const allResults = [];

        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.stack));
        await page.route("**/static/*-suite.js", (route) =>
            route.fulfill({
                path: path.join(
                    packageRoot,
                    "test/matrix/static/conformance-suite.js",
                ),
                contentType: "text/javascript",
            }),
        );
        await page.goto(`/__rawfs${entry.pagePath}`);
        await page.waitForFunction(() => window.__CONFORMANCE_READY__, null, {
            timeout: 90000,
        });
        const manifest = await page.evaluate(
            () => window.__CONFORMANCE_MANIFEST__,
        );
        const pairs = manifest.cases.filter((a) =>
            a.name.startsWith("InterGlb"),
        );
        const cases = [
            ...manifest.cases.filter((a) => !a.name.startsWith("InterGlb")),
            ...(pairs.length ? [pairs] : []),
        ];
        for (const asset of cases.filter(
            (asset) =>
                !process.env.CONFORMANCE_FILTER ||
                (Array.isArray(asset)
                    ? asset.some((a) =>
                          a.name.includes(process.env.CONFORMANCE_FILTER),
                      )
                    : asset.name.includes(process.env.CONFORMANCE_FILTER)),
        )) {
            const result = await runAsset(page, asset);
            allResults.push({ runtime: entry.id, ...result });
            console.log(
                `[conformance] ${entry.id} ${result.name}: ${result.status} (${result.assertionCount ?? 0})${result.error ? " " + result.error : ""}`,
            );
        }
        for (const asset of manifest.invalid) {
            const result = await page.evaluate(
                (asset) => window.__RUN_ASSET__(asset, "invalid"),
                asset,
            );
            allResults.push({ runtime: entry.id, ...result });
        }
        for (const asset of process.env.CONFORMANCE_FILTER
            ? []
            : manifest.models) {
            const result = await runAsset(page, asset);
            allResults.push({ runtime: entry.id, ...result });
        }
        allResults.push(
            ...errors.map((error) => ({
                runtime: entry.id,
                name: "pageerror",
                status: "failed",
                error,
            })),
        );
        await fs.writeFile(
            testInfo.outputPath("conformance-results.json"),
            JSON.stringify(
                { assetsRevision: manifest.revision, results: allResults },
                null,
                2,
            ),
        );
        await page.close();
        expect(allResults.length).toBeGreaterThan(0);
        await testInfo.attach("conformance-results", {
            path: testInfo.outputPath("conformance-results.json"),
            contentType: "application/json",
        });
        expect(allResults.filter((r) => r.status !== "passed")).toEqual([]);
    });

async function runAsset(page, asset) {
    if (
        !asset.metadata?.tests.some((test) => test.requiredInteractions?.length)
    )
        return page.evaluate((asset) => window.__RUN_ASSET__(asset), asset);
    await page.evaluate((asset) => {
        window.__ASSET_RUN_RESULT__ = null;
        window.__RUN_ASSET__(asset).then((result) => {
            window.__ASSET_RUN_RESULT__ = result;
        });
    }, asset);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        const state = await page.evaluate(() => ({
            gesture: window.__PENDING_GESTURE__,
            result: window.__ASSET_RUN_RESULT__,
        }));
        if (state.result) return state.result;
        if (state.gesture) {
            const g = state.gesture;
            await page.mouse.move(g.x, g.y);
            await page.waitForTimeout(100);
            if (g.type === "select") await page.mouse.click(g.x, g.y);
            await page.waitForTimeout(100);
            await page.mouse.move(g.leaveX, g.leaveY);
            await page.waitForTimeout(100);
            await page.evaluate(
                (sequence) => window.__COMPLETE_GESTURE__(sequence),
                g.sequence,
            );
        } else await page.waitForTimeout(25);
    }
    throw new Error(`Timed out driving pointer input for ${asset.name}`);
}
