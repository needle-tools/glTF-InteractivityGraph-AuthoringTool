import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
const packageRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const manifest = JSON.parse(
    await fs.readFile(
        path.join(packageRoot, ".cache/needle-matrix-pages/manifest.json"),
        "utf8",
    ),
);
const latestModule = manifest.pages.filter((entry) => entry.runtimeShape === "module").at(-1);
const entries = (process.env.XR_RUNTIME_FILTER ? manifest.pages : [latestModule]).filter(
    (entry) =>
        !process.env.XR_RUNTIME_FILTER ||
        entry.id.includes(process.env.XR_RUNTIME_FILTER),
);
if (!entries.length)
    throw new Error(
        "No Needle matrix pages. Run the pack-consumer and cache-pages scripts first.",
    );
for (const entry of entries)
    test(`${entry.id}: IWER controllers, hands, AR, VR and session reentry`, async ({
        context,
    }, testInfo) => {
        test.setTimeout(600_000);
        const results = [];
        const errors = [];

        const page = await context.newPage();
        await page.route("**/static/needle-suite.js", (route) =>
            route.fulfill({
                path: path.join(packageRoot, "test/matrix/static/xr-suite.js"),
                contentType: "text/javascript",
            }),
        );
        page.on("console", (message) => {
            if (["error", "warning"].includes(message.type()))
                console.log(`[XR console] ${message.text()}`);
        });
        page.on("pageerror", (error) => errors.push(error.stack));
        await page.goto(`/__rawfs${entry.pagePath}`);
        await page.waitForFunction(() => window.__XR_READY__, null, {
            timeout: 90000,
        });
        for (const mode of process.env.XR_CASE_FILTER
            ? ["immersive-vr"]
            : ["immersive-vr", "immersive-ar"])
            for (const inputMode of process.env.XR_CASE_FILTER
                ? ["controller"]
                : ["controller", "hand"]) {
                const result = await page.evaluate(
                    (args) => window.__RUN_XR__(args),
                    { mode, inputMode },
                );
                results.push({ runtime: entry.id, ...result });
                console.log(
                    `[IWER] ${entry.id} ${mode} ${inputMode}: ${result.status}${result.error ? " " + result.error : ""}`,
                );
                await fs.writeFile(
                    testInfo.outputPath("xr-results.json"),
                    JSON.stringify(results, null, 2),
                );
            }
        results.push(
            ...errors.map((error) => ({
                runtime: entry.id,
                status: "failed",
                error,
            })),
        );
        await fs.writeFile(
            testInfo.outputPath("xr-results.json"),
            JSON.stringify(results, null, 2),
        );
        await page.close();
        await testInfo.attach("xr-results", {
            path: testInfo.outputPath("xr-results.json"),
            contentType: "application/json",
        });
        expect(results.filter((result) => result.status !== "passed")).toEqual(
            [],
        );
    });
