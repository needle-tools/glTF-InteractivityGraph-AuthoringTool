import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
const consumer = path.resolve(process.argv[2] ?? ".cache/consumer");
const { chromium } = createRequire(path.join(consumer, "package.json"))("@playwright/test");
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: process.env.PLAYWRIGHT_USE_METAL ? ["--use-angle=metal"] : [],
});
const base = process.env.EXAMPLES_URL ?? "http://127.0.0.1:5328";
const expected = Array.from({ length: 4000 }, (_, i) => Math.sqrt(i)).reduce((a, b) => a + b, 0);
try {
  for (const backend of ["three", "needle"]) {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      window.results = [];
      document.addEventListener("KHR_INTERACTIVITY:calculation:done", e => window.results.push(e.detail));
    });
    const viewer = backend === "needle" ? "needle-viewer" : "viewer";
    await page.goto(`${base}/examples/_shared/${viewer}.html?asset=../await-results/example.glb`);
    await page.waitForFunction(() => window.example);
    await page.evaluate(() => {
      const e = window.example.runtime.engine, execute = e.executeEventQueueTick;
      window.slices = [];
      e.executeEventQueueTick = () => {
        const start = performance.now(); execute();
        const read = name => e.variables.find(v => v.name === name)?.value[0];
        window.slices.push({ milliseconds: performance.now() - start,
          used: read("cooperative steps executed"), limit: read("cooperative steps per tick") });
      };
    });
    const state = () => page.evaluate(() => {
      const { runtime } = window.example;
      const read = name => runtime.engine.variables.find(v => v.name === "JS global " + name)?.value[0];
      return { result: read("result"), frames: read("frames"), completed: read("completed"),
        position: runtime.model.nodes[0].position.toArray(), results: window.results, slices: window.slices,
        fault: runtime.engine.variables.find(v => v.name === "fault").value[0] };
    });
    // Interrupt mid-calculation; independent presentation must keep advancing.
    await page.keyboard.press("KeyR");
    const initial = await state();
    await page.waitForFunction(() => window.example.runtime.engine.variables.find(v => v.name === "JS global completed").value[0] === 1);
    const final = await state();
    assert.equal(final.fault, false);
    assert.ok(Math.abs(final.result - expected) < 0.01);
    assert.ok(final.frames > initial.frames + 5);
    assert.notDeepEqual(final.position, initial.position);
    assert.ok(final.results.length >= 1);
    assert.ok(Math.abs(final.results.at(-1).result - expected) < 0.01);
    assert.ok(final.slices.every(s => s.used <= s.limit));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(consumer, `await-${backend}.png`) });
    const times = final.slices.map(s => s.milliseconds).sort((a, b) => a - b);
    console.log(`${backend}: numeric result ${final.result.toFixed(2)}, ${final.frames} responsive frames, p95 slice ${times[Math.floor(times.length * .95)].toFixed(2)} ms`);
    await page.close();
  }
} finally { await browser.close(); }
