#!/usr/bin/env node

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  cacheNeedleEngineVersions,
  createCachedNeedleEngineRuntimes,
  createNeedleEngineImportMap,
  createThreeImportMap,
  getDefaultCacheRoot,
  parseMatrixArgs,
  prepareThreeMatrix,
  rawFsUrl,
  resolveNpmPackageVersions,
  writeMatrixPages,
} from "@needle-tools/three-test-matrix";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testRoot, "../..");
const require = createRequire(import.meta.url);
const args = parseMatrixArgs(process.argv.slice(2));
const sharedCacheRoot = getDefaultCacheRoot({ cacheRoot: args.cacheRoot, cwd: packageRoot });
const threePagesRoot = path.join(packageRoot, ".cache/three-matrix-pages");
const needlePagesRoot = path.join(packageRoot, ".cache/needle-matrix-pages");
const needleCacheRoot = path.join(sharedCacheRoot, "needle-engine-versions");
const fixtureUrl = rawFsUrl(path.join(packageRoot, "examples/fixture/interactive.gltf"));
const packageImportMap = createPackageImportMap();
const threeVersions = readVersions("THREE_MATRIX_VERSIONS") ?? args.versions;
const needleVersions = readVersions("NEEDLE_MATRIX_VERSIONS") ?? [
  ...resolveNpmPackageVersions({
    packageName: "@needle-tools/engine",
    versionRanges: ["5.x"],
    cwd: packageRoot,
  }),
  "6.0.0-alpha",
];

const threeMatrix = await prepareThreeMatrix({
  cwd: packageRoot,
  cacheRoot: sharedCacheRoot,
  versions: threeVersions,
  fromRevision: threeVersions ? null : (args.fromRevision ?? 174),
  refresh: args.refresh,
  includeLatest: !threeVersions,
  includeLocalRuntime: false,
  rendererModes: ["webgl"],
  pagesRoot: threePagesRoot,
  createPage({ runtime, rendererMode }) {
    const importMap = createThreeImportMap(runtime, rendererMode);
    Object.assign(importMap.imports, packageImportMap.imports);
    return renderPage({
      importMap,
      title: `${runtime.id} ${rendererMode}`,
      suiteUrl: rawFsUrl(path.join(testRoot, "static/three-suite.js")),
      config: {
        id: runtime.id,
        version: runtime.versionLabel,
        rendererMode,
        fixtureUrl,
      },
    });
  },
});

await cacheNeedleEngineVersions({
  cacheRoot: needleCacheRoot,
  versions: needleVersions,
  runtimeShapes: ["dist"],
  refresh: args.refresh,
  cwd: packageRoot,
});
const needleRuntimes = await createCachedNeedleEngineRuntimes({
  cacheRoot: needleCacheRoot,
  versions: needleVersions,
  runtimeShapes: ["dist"],
});
const needleFiveVersions = needleVersions.filter(version => version.startsWith("5."));
if (needleFiveVersions.length) {
  await cacheNeedleEngineVersions({
    cacheRoot: needleCacheRoot,
    versions: needleFiveVersions,
    runtimeShapes: ["module"],
    refresh: args.refresh,
    cwd: packageRoot,
  });
  needleRuntimes.push(...await createCachedNeedleEngineRuntimes({
    cacheRoot: needleCacheRoot,
    versions: needleFiveVersions,
    runtimeShapes: ["module"],
  }));
}
const needleManifest = await writeMatrixPages({
  pagesRoot: needlePagesRoot,
  clean: true,
  axes: [{
    name: "runtime",
    values: needleRuntimes,
    pathPart: runtime => runtime.id,
    idPart: runtime => runtime.id,
  }],
  createPage({ runtime }) {
    const importMap = createNeedleEngineImportMap(runtime, { baseImportMap: packageImportMap });
    return renderPage({
      importMap,
      title: runtime.id,
      suiteUrl: rawFsUrl(path.join(testRoot, "static/needle-suite.js")),
      config: {
        id: runtime.id,
        version: runtime.versionLabel,
        runtimeShape: runtime.runtimeShape,
        fixtureUrl,
      },
    });
  },
  createEntry({ runtime, id, pagePath }) {
    return {
      id,
      version: runtime.versionLabel,
      runtimeShape: runtime.runtimeShape,
      pagePath,
    };
  },
});

console.log(`Wrote ${threeMatrix.pagesManifest.pages.length} Three.js matrix page(s).`);
console.log(`Wrote ${needleManifest.pages.length} Needle Engine matrix page(s).`);
console.log(`Using matrix cache at ${sharedCacheRoot}.`);

function createPackageImportMap() {
  const animationPointerEntry = require.resolve("@needle-tools/three-animation-pointer");
  const glMatrixRoot = path.dirname(require.resolve("gl-matrix/package.json"));
  return {
    imports: {
      "@needle-tools/gltf-interactivity": rawFsUrl(path.join(packageRoot, "dist/index.js")),
      "@needle-tools/gltf-interactivity/needle": rawFsUrl(path.join(packageRoot, "dist/needle.js")),
      "@needle-tools/three-animation-pointer": rawFsUrl(animationPointerEntry),
      "gl-matrix": rawFsUrl(path.join(glMatrixRoot, "esm/index.js")),
    },
  };
}

function renderPage({ importMap, title, suiteUrl, config }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <script type="importmap">${JSON.stringify(importMap)}</script>
    <script>window.__GLTF_INTERACTIVITY_MATRIX_CONFIG__ = ${JSON.stringify(config)};</script>
  </head>
  <body>
    <canvas id="fixture" width="128" height="128"></canvas>
    <script type="module" src="${suiteUrl}"></script>
  </body>
</html>`;
}

function readVersions(name) {
  const value = process.env[name];
  return value ? value.split(",").map(version => version.trim()).filter(Boolean) : null;
}
