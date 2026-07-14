import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testRoot, "../..");

test("supports the Three.js release matrix", async ({ context }) => {
  const manifest = await readManifest("three-matrix-pages");
  const results = await runPages(context, manifest.pages);

  expect(results).toHaveLength(manifest.pages.length);
  for (const result of results) {
    expect(result).toMatchObject({
      status: "passed",
      rendererMode: "webgl",
      readyCount: 1,
      nodeX: 1,
      assertionCount: 7,
    });
    expect(result.coloredPixels).toBeGreaterThan(0);
  }
});

test("supports the Needle Engine runtime shapes", async ({ context }) => {
  const manifest = await readManifest("needle-matrix-pages");
  expect(manifest.pages.length).toBeGreaterThan(0);
  expect(manifest.pages.every(entry => entry.runtimeShape === "dist" || entry.runtimeShape === "module")).toBe(true);
  if (!process.env.NEEDLE_MATRIX_VERSIONS) {
    expect(manifest.pages.some(entry => entry.version.startsWith("5.") && entry.runtimeShape === "dist")).toBe(true);
    expect(manifest.pages.some(entry => entry.version.startsWith("5.") && entry.runtimeShape === "module")).toBe(true);
    expect(manifest.pages.some(entry => entry.version.startsWith("6.") && entry.runtimeShape === "dist")).toBe(true);
    expect(manifest.pages.some(entry => entry.version.startsWith("6.") && entry.runtimeShape === "module")).toBe(true);
  }
  const results = await runPages(context, manifest.pages);

  expect(results).toHaveLength(manifest.pages.length);
  for (const result of results) {
    expect(result).toMatchObject({
      status: "passed",
      readyCount: 1,
      nodeX: 1,
      assertionCount: 5,
    });
  }
});

async function readManifest(name) {
  return JSON.parse(await readFile(path.join(packageRoot, ".cache", name, "manifest.json"), "utf8"));
}

async function runPages(context, pages) {
  const results = [];
  const failures = [];

  for (const matrixPage of pages) {
    const page = await context.newPage();
    const diagnostics = [];
    page.on("console", message => {
      if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
    });
    page.on("pageerror", error => diagnostics.push(`pageerror: ${error.stack || error.message}`));
    page.on("requestfailed", request => diagnostics.push(`requestfailed: ${request.failure()?.errorText || "unknown"} ${request.url()}`));
    page.on("response", response => {
      if (response.status() >= 400) diagnostics.push(`response: ${response.status()} ${response.url()}`);
    });

    try {
      await page.goto(`/__rawfs${matrixPage.pagePath}`);
      const handle = await page.waitForFunction(
        () => window.__GLTF_INTERACTIVITY_MATRIX_RESULT__,
        null,
        { timeout: 90_000 },
      );
      const result = await handle.jsonValue();
      if (result.status !== "passed") throw new Error(result.error || "matrix suite failed");
      if (diagnostics.length) throw new Error(diagnostics.join("\n"));
      results.push(result);
      console.log(`[gltf-interactivity-matrix] ${matrixPage.id}: passed`);
    }
    catch (error) {
      failures.push(`${matrixPage.id}: ${error instanceof Error ? error.stack || error.message : String(error)}\n${diagnostics.join("\n")}`);
    }
    finally {
      await page.close();
    }
  }

  if (failures.length) throw new Error(`glTF interactivity matrix failures:\n\n${failures.join("\n\n")}`);
  return results;
}
