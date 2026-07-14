import "@needle-tools/engine";
import {
  getInteractivityRuntime,
  registerNeedleInteractivity,
} from "@needle-tools/gltf-interactivity/needle";

const config = window.__GLTF_INTERACTIVITY_MATRIX_CONFIG__;

try {
  window.__GLTF_INTERACTIVITY_MATRIX_RESULT__ = await runSuite();
}
catch (error) {
  window.__GLTF_INTERACTIVITY_MATRIX_RESULT__ = {
    status: "failed",
    id: config.id,
    error: error?.stack || error?.message || String(error),
  };
}

async function runSuite() {
  let runtime;
  let readyCount = 0;
  const unregister = registerNeedleInteractivity({
    pointerEvents: false,
    onReady(value) {
      runtime = value;
      readyCount += 1;
    },
  });
  const engine = document.createElement("needle-engine");
  engine.style.width = "128px";
  engine.style.height = "128px";
  document.body.append(engine);

  try {
    const loaded = waitForLoad(engine);
    engine.setAttribute("src", config.fixtureUrl);
    const loadedFile = await loaded;
    await waitFor(() => runtime?.model.nodes[0]?.position.x === 1);

    assert(runtime, "Needle created the interactivity runtime during import");
    assert(readyCount === 1, "Needle created the runtime exactly once");
    assert(getInteractivityRuntime(loadedFile) === runtime, "Needle returned the loader-attached runtime");
    assert(runtime.model.nodes[0]?.position.x === 1, "the graph started automatically while loading");
    assert(engine.classList.contains("loading-finished"), "Needle completed its normal element loading path");

    return {
      status: "passed",
      id: config.id,
      version: config.version,
      runtimeShape: config.runtimeShape,
      readyCount,
      nodeX: runtime.model.nodes[0].position.x,
      assertionCount: 5,
    };
  }
  finally {
    runtime?.dispose();
    unregister();
    engine.remove();
  }
}

function waitForLoad(engine) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Needle loadfinished")), 60_000);
    engine.addEventListener("loadfinished", event => {
      clearTimeout(timeout);
      const file = event.detail?.loadedFiles?.[0]?.file;
      if (!file) reject(new Error("Needle loadfinished did not contain a glTF file"));
      else resolve(file);
    }, { once: true });
  });
}

async function waitFor(predicate) {
  const deadline = performance.now() + 10_000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("Timed out waiting for automatic graph execution");
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
