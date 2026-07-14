import type { SampleAsset, SampleManifest, SampleMetadata, SampleSubTest } from "./sampleTypes";
import "./sampleBrowser.css";

const floatAbsoluteTolerance = 0.05;
const floatRelativeTolerance = 0.03;

interface RuntimeVariable {
  value?: unknown[];
}

export interface BrowserRuntime {
  graph?: {
    declarations?: Array<{ op?: string }>;
    nodes?: Array<{
      declaration?: number;
      values?: { duration?: { value?: unknown[] } };
    }>;
  };
  engine: {
    variables: RuntimeVariable[];
    executeEventQueueTick(): void;
    pauseEventQueue(): void;
  };
}

export interface LoadedSample {
  runtime?: BrowserRuntime;
}

export interface SampleBrowserOptions {
  engineName: string;
  loadAsset(asset: SampleAsset): Promise<LoadedSample>;
  defaultAssetId?: string;
}

interface AssetResult {
  asset: SampleAsset;
  passed: number;
  failed: number;
  failures: string[];
}

export async function createSampleBrowser(options: SampleBrowserOptions): Promise<void> {
  document.body.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <h1>glTF Interactivity</h1>
          <span class="engine-name">${escapeHtml(options.engineName)}</span>
        </div>
        <div class="suite-totals" id="suite-totals">Loading asset index...</div>
      </header>
      <div class="workspace">
        <aside class="asset-panel" aria-label="Sample assets">
          <label for="asset-search">Search</label>
          <input id="asset-search" type="search" autocomplete="off" placeholder="Name, category, or operation">
          <label for="asset-select">Asset</label>
          <select id="asset-select" size="14" aria-label="Asset"></select>
          <div class="asset-details">
            <strong id="asset-title">No asset selected</strong>
            <span id="asset-meta"></span>
            <span id="asset-description"></span>
          </div>
          <div class="actions">
            <button id="run-selected" type="button">Run selected</button>
            <button id="run-all" type="button">Run all tests</button>
            <button id="stop-run" type="button" disabled>Stop</button>
          </div>
          <progress id="test-progress" value="0" max="1"></progress>
          <div class="run-summary" id="run-summary">Ready</div>
        </aside>
        <main class="viewport-panel">
          <div id="viewport-host"></div>
          <div class="load-status" id="load-status">Waiting for asset</div>
        </main>
      </div>
      <section class="results-panel" aria-live="polite">
        <div class="results-header">
          <h2>Results</h2>
          <button id="clear-results" type="button">Clear</button>
        </div>
        <div id="test-results" class="test-results"></div>
      </section>
    </div>`;

  const search = element<HTMLInputElement>("#asset-search");
  const select = element<HTMLSelectElement>("#asset-select");
  const runSelected = element<HTMLButtonElement>("#run-selected");
  const runAll = element<HTMLButtonElement>("#run-all");
  const stop = element<HTMLButtonElement>("#stop-run");
  const progress = element<HTMLProgressElement>("#test-progress");
  const results = element<HTMLElement>("#test-results");
  const loadStatus = element<HTMLElement>("#load-status");
  const runSummary = element<HTMLElement>("#run-summary");
  let manifest: SampleManifest;
  let selectedId = new URL(location.href).searchParams.get("asset") ?? options.defaultAssetId;
  let running = false;
  let stopRequested = false;

  try {
    const response = await fetch("/__sample_assets__/manifest.json", { cache: "no-store" });
    manifest = await response.json() as SampleManifest;
    if (!response.ok || !manifest.available) throw new Error(manifest.error ?? `Asset index failed with HTTP ${response.status}`);
  }
  catch (error) {
    const message = errorMessage(error);
    element("#suite-totals").textContent = "Asset repository unavailable";
    loadStatus.textContent = message;
    loadStatus.dataset.state = "failed";
    setControlsDisabled(true);
    return;
  }

  element("#suite-totals").textContent = `${manifest.totals.testAssets} test assets / ${manifest.totals.runnableSubtests} subtests / ${manifest.totals.models} models`;
  search.addEventListener("input", renderOptions);
  select.addEventListener("change", () => {
    selectedId = select.value;
    updateSelectionDetails();
    const url = new URL(location.href);
    url.searchParams.set("asset", selectedId);
    history.replaceState(null, "", url);
    if (!running) void loadSelectedAsset();
  });
  runSelected.addEventListener("click", () => void runSelectedTest());
  runAll.addEventListener("click", () => void runAllTests());
  stop.addEventListener("click", () => {
    stopRequested = true;
    stop.disabled = true;
    runSummary.textContent = "Stopping after current asset...";
  });
  element<HTMLButtonElement>("#clear-results").addEventListener("click", () => {
    results.replaceChildren();
    runSummary.textContent = "Ready";
    progress.value = 0;
  });

  renderOptions();
  await loadSelectedAsset();

  function renderOptions(): void {
    const query = search.value.trim().toLowerCase();
    const filtered = manifest.assets.filter(asset => {
      const haystack = `${asset.label} ${asset.name} ${asset.tags.join(" ")}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    const previous = selectedId;
    select.replaceChildren();
    appendGroup("Showcase models", filtered.filter(asset => asset.kind === "model"));
    appendGroup("Test assets", filtered.filter(asset => asset.kind === "test"));
    selectedId = filtered.some(asset => asset.id === previous) ? previous : filtered[0]?.id;
    select.value = selectedId ?? "";
    updateSelectionDetails();
  }

  function appendGroup(label: string, assets: SampleAsset[]): void {
    if (assets.length === 0) return;
    const group = document.createElement("optgroup");
    group.label = `${label} (${assets.length})`;
    for (const asset of assets) {
      const option = document.createElement("option");
      option.value = asset.id;
      option.textContent = asset.kind === "test" ? `${asset.label} (${asset.subtestCount})` : asset.label;
      group.append(option);
    }
    select.append(group);
  }

  function updateSelectionDetails(): void {
    const asset = getSelectedAsset();
    element("#asset-title").textContent = asset?.label ?? "No matching assets";
    element("#asset-meta").textContent = asset
      ? asset.kind === "test"
        ? `${asset.name} / ${asset.subtestCount} subtests${asset.runnable ? "" : " / paired run required"}`
        : `Model / ${asset.name}`
      : "";
    element("#asset-description").textContent = asset?.description ?? "";
    runSelected.disabled = running || !asset?.runnable;
  }

  async function loadSelectedAsset(): Promise<LoadedSample | undefined> {
    const asset = getSelectedAsset();
    if (!asset) return undefined;
    loadStatus.textContent = `Loading ${asset.label}...`;
    loadStatus.dataset.state = "loading";
    try {
      const loaded = await options.loadAsset(asset);
      loadStatus.textContent = asset.label;
      loadStatus.dataset.state = "ready";
      return loaded;
    }
    catch (error) {
      loadStatus.textContent = `${asset.label}: ${errorMessage(error)}`;
      loadStatus.dataset.state = "failed";
      throw error;
    }
  }

  async function runSelectedTest(): Promise<void> {
    const asset = getSelectedAsset();
    if (!asset?.runnable) return;
    beginRun(asset.subtestCount);
    results.replaceChildren();
    const result = await executeAsset(asset);
    appendResult(result);
    finishRun([result]);
  }

  async function runAllTests(): Promise<void> {
    const assets = manifest.assets.filter(asset => asset.runnable && asset.subtestCount > 0);
    const total = assets.reduce((sum, asset) => sum + asset.subtestCount, 0);
    beginRun(total);
    results.replaceChildren();
    const runResults: AssetResult[] = [];
    for (let index = 0; index < assets.length && !stopRequested; index += 1) {
      const asset = assets[index];
      select.value = asset.id;
      selectedId = asset.id;
      updateSelectionDetails();
      runSummary.textContent = `${index + 1}/${assets.length} / ${asset.label}`;
      const result = await executeAsset(asset);
      runResults.push(result);
      appendResult(result);
      progress.value += result.passed + result.failed;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    finishRun(runResults, stopRequested);
  }

  async function executeAsset(asset: SampleAsset): Promise<AssetResult> {
    try {
      const metadataPromise = fetchMetadata(asset);
      const loaded = await options.loadAsset(asset);
      const metadata = await metadataPromise;
      if (!loaded.runtime?.graph) throw new Error("The loader did not attach an executable KHR_interactivity runtime");
      await waitForGraph(loaded.runtime);
      const failures = collectFailures(loaded.runtime.engine.variables, metadata);
      return {
        asset,
        passed: asset.subtestCount - failures.length,
        failed: failures.length,
        failures,
      };
    }
    catch (error) {
      return {
        asset,
        passed: 0,
        failed: asset.subtestCount,
        failures: [errorMessage(error)],
      };
    }
  }

  function appendResult(result: AssetResult): void {
    const row = document.createElement("details");
    row.className = result.failed === 0 ? "result-row passed" : "result-row failed";
    if (result.failed > 0) row.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${result.asset.name} / ${result.passed}/${result.passed + result.failed}`;
    row.append(summary);
    if (result.failures.length > 0) {
      const list = document.createElement("ul");
      for (const failure of result.failures) {
        const item = document.createElement("li");
        item.textContent = failure;
        list.append(item);
      }
      row.append(list);
    }
    results.append(row);
    row.scrollIntoView({ block: "nearest" });
  }

  function beginRun(total: number): void {
    running = true;
    stopRequested = false;
    progress.max = Math.max(1, total);
    progress.value = 0;
    setControlsDisabled(true);
    stop.disabled = false;
  }

  function finishRun(runResults: AssetResult[], stopped = false): void {
    const passed = runResults.reduce((sum, result) => sum + result.passed, 0);
    const failed = runResults.reduce((sum, result) => sum + result.failed, 0);
    progress.value = passed + failed;
    runSummary.textContent = `${stopped ? "Stopped / " : ""}${passed}/${passed + failed} passed${failed ? ` / ${failed} failed` : ""}`;
    running = false;
    setControlsDisabled(false);
    updateSelectionDetails();
  }

  function setControlsDisabled(disabled: boolean): void {
    search.disabled = disabled;
    select.disabled = disabled;
    runAll.disabled = disabled;
    runSelected.disabled = disabled || !getSelectedAsset()?.runnable;
    stop.disabled = !disabled;
  }

  function getSelectedAsset(): SampleAsset | undefined {
    return manifest.assets.find(asset => asset.id === selectedId);
  }
}

async function fetchMetadata(asset: SampleAsset): Promise<SampleMetadata> {
  if (!asset.metadataUrl) throw new Error("This asset has no test metadata");
  const response = await fetch(asset.metadataUrl);
  if (!response.ok) throw new Error(`Metadata request failed with HTTP ${response.status}`);
  return response.json() as Promise<SampleMetadata>;
}

async function waitForGraph(runtime: BrowserRuntime): Promise<void> {
  const waitMs = getGraphSettleMilliseconds(runtime.graph);
  await new Promise(resolve => setTimeout(resolve, waitMs));
  runtime.engine.executeEventQueueTick();
  runtime.engine.pauseEventQueue();
}

function getGraphSettleMilliseconds(graph: BrowserRuntime["graph"]): number {
  let seconds = 0.02;
  for (const node of graph?.nodes ?? []) {
    const op = graph?.declarations?.[node.declaration ?? -1]?.op;
    if (op === "flow/setDelay" || op === "flow/throttle" || op === "variable/interpolate" || op === "pointer/interpolate") {
      const duration = Number(node.values?.duration?.value?.[0]);
      if (Number.isFinite(duration) && duration > seconds) seconds = duration + 0.35;
    }
  }
  return Math.max(20, Math.ceil(Math.min(seconds, 6) * 1000));
}

function collectFailures(variables: RuntimeVariable[], metadata: SampleMetadata): string[] {
  const failures: string[] = [];
  for (const test of metadata.tests) {
    for (const subtest of test.subTests) {
      const failure = getSubtestFailure(variables, subtest);
      if (failure) failures.push(`${test.name} / ${subtest.name}: ${failure}`);
    }
  }
  return failures;
}

function getSubtestFailure(variables: RuntimeVariable[], subtest: SampleSubTest): string | undefined {
  const result = variables[subtest.resultVarId]?.value;
  const success = variables[subtest.successResultVarId]?.value?.[0];
  if (valuesEqual(result, subtest.expectedResultValue, subtest.resultVarType) && success === true) return undefined;
  return `expected ${formatValue(subtest.expectedResultValue)} and success=true, got result=${formatValue(result)} success=${formatValue(success)}`;
}

function valuesEqual(actual: unknown[] | undefined, expected: unknown[], typeName: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return expected.every((expectedValue, index) => {
    const actualValue = actual[index];
    if (!typeName.startsWith("float")) return Object.is(actualValue, expectedValue);
    if (isNaNLike(expectedValue)) return isNaNLike(actualValue);
    if (isPositiveInfinityLike(expectedValue)) return Number(actualValue) === Infinity;
    if (isNegativeInfinityLike(expectedValue)) return Number(actualValue) === -Infinity;
    const actualNumber = Number(actualValue);
    const expectedNumber = Number(expectedValue);
    const difference = Math.abs(actualNumber - expectedNumber);
    return difference <= floatAbsoluteTolerance
      || difference / Math.max(1, Math.abs(expectedNumber)) <= floatRelativeTolerance;
  });
}

function isNaNLike(value: unknown): boolean {
  return value === "NaN" || Number.isNaN(Number(value));
}

function isPositiveInfinityLike(value: unknown): boolean {
  return value === "Infinity" || Number(value) === Infinity;
}

function isNegativeInfinityLike(value: unknown): boolean {
  return value === "-Infinity" || Number(value) === -Infinity;
}

function formatValue(value: unknown): string {
  return JSON.stringify(value, (_key, innerValue) => (
    typeof innerValue === "number" && !Number.isFinite(innerValue) ? String(innerValue) : innerValue
  )) ?? "undefined";
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element ${selector}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
