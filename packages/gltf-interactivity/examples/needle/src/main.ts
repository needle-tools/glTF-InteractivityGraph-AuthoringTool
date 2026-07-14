import "@needle-tools/engine";
import {
  registerNeedleInteractivity,
  type InteractivityRuntime,
} from "@needle-tools/gltf-interactivity/needle";
import {
  createSampleBrowser,
  type BrowserRuntime,
} from "../../shared/sampleBrowser";
import type { SampleAsset } from "../../shared/sampleTypes";

let engine: HTMLElement | undefined;
let currentRuntime: InteractivityRuntime | undefined;
let resolveRuntime: ((runtime: InteractivityRuntime) => void) | undefined;
let loadSequence = 0;

registerNeedleInteractivity({
  onReady(runtime) {
    currentRuntime = runtime;
    resolveRuntime?.(runtime);
    resolveRuntime = undefined;
  },
});

void createSampleBrowser({
  engineName: "Needle Engine",
  defaultAssetId: "model:WhackAMole",
  loadAsset,
});

async function loadAsset(asset: SampleAsset): Promise<{ runtime?: BrowserRuntime }> {
  const element = getEngine();
  currentRuntime?.dispose();
  currentRuntime = undefined;
  const runtimePromise = new Promise<InteractivityRuntime>((resolve) => {
    resolveRuntime = resolve;
  });
  const loadedPromise = waitForLoad(element);
  const url = new URL(asset.url, location.href);
  url.searchParams.set("load", String(++loadSequence));
  element.setAttribute("src", url.pathname + url.search);
  const [runtime] = await Promise.all([runtimePromise, loadedPromise]);
  return { runtime: runtime as BrowserRuntime };
}

function getEngine(): HTMLElement {
  if (engine) return engine;
  engine = document.createElement("needle-engine");
  engine.setAttribute("camera-controls", "true");
  engine.setAttribute("background-color", "#ffffff");
  engine.setAttribute("loading-style", "light");
  document.querySelector("#viewport-host")!.append(engine);
  return engine;
}

function waitForLoad(element: HTMLElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Needle loadfinished"));
    }, 60_000);
    const onLoaded = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      element.removeEventListener("loadfinished", onLoaded);
    };
    element.addEventListener("loadfinished", onLoaded, { once: true });
  });
}
