import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
const consumer = path.resolve(process.argv[2] ?? ".cache/consumer"),
  require = createRequire(path.join(consumer, "package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  }),
  page = await browser.newPage({ viewport: { width: 1000, height: 750 } }),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.EXAMPLES_URL ?? "http://127.0.0.1:5328";
const state = () =>
  page.evaluate(() => {
    const { runtime } = window.example;
    return {
      nodes: runtime.model.nodes.slice(0, 3).map((n) => n.position.toArray()),
      variables: Object.fromEntries(
        runtime.engine.variables.map((v) => [v.name, v.value[0]]),
      ),
    };
  });
const open = async (name) => {
  await page.goto(base + "/examples/_shared/viewer.html?asset=../" + name + "/example.glb");
  await page.waitForFunction(() => window.example);
  await page.waitForTimeout(50);
};
try {
  await open("surface-cursor");
  await page.mouse.click(560, 400);
  await page.waitForFunction(
    () => window.example.runtime.engine.variables[0].value[0] !== "",
  );
  let s = await state();
  assert.equal(s.variables["selected node"], "/nodes/0");
  assert.ok(s.nodes[1][0] > 0.2);
  assert.ok(s.nodes[1][1] < 0);
  assert.ok(Math.abs(s.nodes[1][2]) < 1e-6);
  await open("matrix-transform");
  s = await state();
  assert.deepEqual(s.nodes[1], [0.5, 0.4, 0]);
  await open("timed-animation");
  await page.mouse.click(560, 400);
  await page.waitForFunction(
    () => window.example.runtime.engine.variables[0].value[0] === true,
  );
  s = await state();
  assert.ok(Math.abs(s.nodes[0][1] - 1) < 1e-5);
  assert.match(
    s.variables["timer token"],
    /^\/extensions\/KHR_interactivity\/delays\//,
  );
  await open("timed-animation");
  const cancelledToken = await page.evaluate(() => {
    // Keep start and cancellation in one browser task: the timer is only 50 ms.
    // The preceding case already exercises the real mouse/selection path.
    window.example.runtime.engine.select(0, 0, [0.2, -0.1, 0], [0, 0, 5]);
    window.example.runtime.engine.executeEventQueueTick();
    const token = window.example.runtime.engine.variables[1].value[0];
    window.example.send("cancel");
    window.example.runtime.engine.executeEventQueueTick();
    return token;
  });
  assert.match(cancelledToken, /^\/extensions\/KHR_interactivity\/delays\//);
  await page.waitForTimeout(650);
  s = await state();
  assert.equal(s.variables["animation finished"], false);
  assert.equal(s.nodes[0][1], 0);
  await open("grid-navigation");
  s = await state();
  assert.deepEqual(s.nodes[0], [1.5, 0.8, 1.5]);
  const view = await page.evaluate(() => {
    const e = window.example,
      direction = e.camera.getWorldDirection(e.camera.position.clone());
    e.renderer.render(e.scene, e.camera);
    const gl = e.renderer.getContext(),
      w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight,
      pixels = new Uint8Array(w * h * 4),
      colors = new Set();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // Sample the actual scene below the header, excluding the crosshair.
    for (let y = 40; y < h * 0.6; y += 16)
      for (let x = 40; x < w - 40; x += 16) {
        const i = (y * w + x) * 4;
        colors.add(
          [pixels[i] >> 4, pixels[i + 1] >> 4, pixels[i + 2] >> 4].join(","),
        );
      }
    return { direction: direction.toArray(), colors: colors.size };
  });
  assert.ok(
    view.direction[0] > 0.99,
    "Starting view must face along the open corridor",
  );
  assert.ok(
    view.colors >= 3,
    "Rendered view must show distinct arena surfaces, not one close wall",
  );
  await page.screenshot({ path: path.join(consumer, "grid-navigation.png") });
  // Exercise real keyboard input and compare it with the camera's direction.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(100);
  await page.keyboard.up("KeyW");
  s = await state();
  assert.ok(s.nodes[0][0] > 1.5);
  assert.ok(Math.abs(s.nodes[0][2] - 1.5) < 1e-6);
  await page.evaluate(() => window.example.send("reset"));
  await page.waitForFunction(
    () => window.example.runtime.model.nodes[0].position.x === 1.5,
  );
  await page.evaluate(() =>
    window.example.send("move", { forward: 0.2, strafe: 0, turn: 0 }),
  );
  await page.waitForFunction(
    () => window.example.runtime.model.nodes[0].position.x > 1.6,
  );
  s = await state();
  assert.ok(Math.abs(s.nodes[0][0] - 1.7) < 1e-6);
  await page.evaluate(() =>
    window.example.send("move", { forward: 6, strafe: 0, turn: 0 }),
  );
  await page.waitForTimeout(50);
  s = await state();
  assert.ok(Math.abs(s.nodes[0][0] - 1.7) < 1e-6);
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      window.example.runtime.engine.variables.find(
        (v) => v.name === "JS global shots",
      ).value[0] === 1,
  );
  s = await state();
  assert.ok(
    s.variables["JS global lastHit"] > 5.2 &&
      s.variables["JS global lastHit"] < 5.4,
  );
  assert.ok(s.nodes[2][0] > 6.9 && s.nodes[2][0] < 7.01);
  await page.evaluate(() =>
    window.example.send("move", { forward: 0, strafe: 0, turn: 0.2 }),
  );
  await page.waitForTimeout(50);
  const aligned = await page.evaluate(() => {
    const e = window.example,
      from = e.runtime.model.nodes[0].position.clone(),
      direction = e.camera.getWorldDirection(from.clone());
    e.send("move", { forward: 0.1, strafe: 0, turn: 0 });
    e.runtime.engine.executeEventQueueTick();
    e.runtime.engine.executeEventQueueTick();
    const delta = e.runtime.model.nodes[0].position
      .clone()
      .sub(from)
      .normalize();
    return {
      dot: delta.dot(direction),
      delta: delta.toArray(),
      direction: direction.toArray(),
      quaternion: e.runtime.model.nodes[0].quaternion.toArray(),
      yaw: e.runtime.engine.variables.find((v) => v.name === "JS global yaw")
        .value,
    };
  });
  assert.ok(
    aligned.dot > 0.999,
    "Forward movement must remain aligned with the turned camera: " +
      JSON.stringify(aligned),
  );
  await page.keyboard.press("KeyR");
  await page.waitForFunction(
    () => window.example.runtime.model.nodes[0].position.x === 1.5,
  );
  s = await state();
  assert.equal(s.variables["JS global shots"], 0);
  await open("click-hover");
  await page.mouse.move(560, 400);
  await page.waitForTimeout(80);
  await page.mouse.click(560, 400);
  await page.waitForTimeout(80);
  s = await state();
  assert.equal(s.variables["JS global clicks"], 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(consumer, "examples.png") });
  console.log(
    "Packed examples passed: selection/ref, homogeneous transform, timer/animation/cancel, grid movement/collision/hitscan/reset, click/hover.",
  );
} finally {
  await browser.close();
}
