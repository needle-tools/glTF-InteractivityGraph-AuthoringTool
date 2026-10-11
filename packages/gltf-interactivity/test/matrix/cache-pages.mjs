#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
    cacheNeedleEngineVersions,
    buildWorkerBundle,
    createCachedNeedleEngineRuntimes,
    createNeedleEngineImportMap,
    createThreeImportMap,
    getDefaultCacheRoot,
    parseMatrixArgs,
    prepareThreeMatrix,
    rawFsUrl,
    writeMatrixPages,
} from "@needle-tools/three-test-matrix";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testRoot, "../..");
const require = createRequire(import.meta.url);
const args = parseMatrixArgs(process.argv.slice(2));
const sharedCacheRoot = getDefaultCacheRoot({
    cacheRoot: args.cacheRoot,
    cwd: packageRoot,
});
const threePagesRoot = path.join(packageRoot, ".cache/three-matrix-pages");
const needlePagesRoot = path.join(packageRoot, ".cache/needle-matrix-pages");
const needleCacheRoot = path.join(
    sharedCacheRoot,
    "needle-engine-peer-isolated-versions",
);
const fixtureUrl = rawFsUrl(
    path.join(packageRoot, "examples/fixture/interactive.gltf"),
);
const packed = JSON.parse(
    fs.readFileSync(
        path.join(packageRoot, ".cache/packed-consumer.json"),
        "utf8",
    ),
);
const packageImportMap = createPackageImportMap();
const assetManifestUrl = writeAssetManifest();
const threeVersions = readVersions("THREE_MATRIX_VERSIONS") ?? args.versions;
const needleTags = JSON.parse(
    execFileSync(
        "npm",
        ["view", "@needle-tools/engine", "dist-tags", "--json"],
        { encoding: "utf8" },
    ),
);
const needleVersions = readVersions("NEEDLE_MATRIX_VERSIONS") ?? [
    ...new Set([
        needleTags.stable,
        needleTags.latest,
    ]),
];

const threeMatrix = await prepareThreeMatrix({
    cwd: packageRoot,
    cacheRoot: sharedCacheRoot,
    versions: threeVersions,
    // Use the harness's milestone defaults; an exhaustive minor sweep is opt-in.
    fromRevision: threeVersions ? null : args.fromRevision,
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
                assetManifestUrl,
            },
        });
    },
});

const previousLegacyPeerDeps = process.env.npm_config_legacy_peer_deps;
process.env.npm_config_legacy_peer_deps = "true";
try {
    // Keep each Engine release's declared Three alias from being displaced by
    // peer auto-installation when the browser import map is generated.
    await cacheNeedleEngineVersions({
        cacheRoot: needleCacheRoot,
        versions: needleVersions,
        runtimeShapes: ["dist", "module"],
        refresh: args.refresh,
        cwd: packageRoot,
    });
} finally {
    if (previousLegacyPeerDeps === undefined)
        delete process.env.npm_config_legacy_peer_deps;
    else process.env.npm_config_legacy_peer_deps = previousLegacyPeerDeps;
}
const needleRuntimes = await createCachedNeedleEngineRuntimes({
    cacheRoot: needleCacheRoot,
    versions: needleVersions,
    runtimeShapes: ["dist", "module"],
});
// Workers do not inherit the page's import map. Bundle their dependencies with the same Three alias.
for (const runtime of needleRuntimes.filter(
    (runtime) => runtime.runtimeShape === "module",
)) {
    const runtimeRequire = createRequire(
        path.join(runtime.packageRoot, "package.json"),
    );
    const bundleRoot = path.dirname(runtime.entryUrl.slice("/__rawfs".length));
    const threeRoot = runtime.imports["three/"].slice("/__rawfs".length);
    const workers = [
        [
            "three-mesh-bvh/src/workers/generateMeshBVH.worker.js",
            runtimeRequire.resolve(
                "three-mesh-bvh/src/workers/generateMeshBVH.worker.js",
            ),
        ],
        [
            "gltf-progressive.worker.js",
            path.resolve(
                runtime.packageRoot,
                "../../@needle-tools/gltf-progressive/lib/worker/gltf-progressive.worker.js",
            ),
        ],
    ];
    for (const [relativePath, entry] of workers) {
        if (!fs.existsSync(entry)) continue;
        await buildWorkerBundle({
            contents: `import ${JSON.stringify(entry)};`,
            outfile: path.join(bundleRoot, relativePath),
            packageRoot: threeRoot,
            resolveDir: runtime.packageRoot,
        });
    }
}
const needleManifest = await writeMatrixPages({
    pagesRoot: needlePagesRoot,
    clean: true,
    axes: [
        {
            name: "runtime",
            values: needleRuntimes,
            pathPart: (runtime) => runtime.id,
            idPart: (runtime) => runtime.id,
        },
    ],
    createPage({ runtime }) {
        const importMap = createNeedleEngineImportMap(runtime, {
            baseImportMap: packageImportMap,
        });
        return renderPage({
            importMap,
            title: runtime.id,
            suiteUrl: rawFsUrl(path.join(testRoot, "static/needle-suite.js")),
            config: {
                id: runtime.id,
                version: runtime.versionLabel,
                runtimeShape: runtime.runtimeShape,
                fixtureUrl,
                assetManifestUrl,
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

console.log(
    `Wrote ${threeMatrix.pagesManifest.pages.length} Three.js matrix page(s).`,
);
console.log(
    `Wrote ${needleManifest.pages.length} Needle Engine matrix page(s).`,
);
console.log(`Using matrix cache at ${sharedCacheRoot}.`);

function createPackageImportMap() {
    const consumerRequire = createRequire(
        path.join(packed.consumer, "package.json"),
    );
    const animationPointerEntry = consumerRequire.resolve(
        "@needle-tools/three-animation-pointer",
    );
    const glMatrixRoot = path.dirname(
        consumerRequire.resolve("gl-matrix/package.json"),
    );
    return {
        imports: {
            "three-gltf-interactivity": rawFsUrl(
                path.join(
                    packed.consumer,
                    "node_modules/three-gltf-interactivity/dist/index.js",
                ),
            ),
            "three-gltf-interactivity/needle": rawFsUrl(
                path.join(
                    packed.consumer,
                    "node_modules/three-gltf-interactivity/dist/needle.js",
                ),
            ),
            "@needle-tools/three-animation-pointer": rawFsUrl(
                animationPointerEntry,
            ),
            "@khronosgroup/gltf-interactivity-engine": rawFsUrl(
                path.join(
                    packed.consumer,
                    "node_modules/@khronosgroup/gltf-interactivity-engine/build/index.js",
                ),
            ),
            "@iwer/sem": rawFsUrl(
                path.join(
                    path.dirname(require.resolve("@iwer/sem/package.json")),
                    "build/es/index.js",
                ),
            ),
            iwer: rawFsUrl(
                path.join(
                    path.dirname(require.resolve("iwer/package.json")),
                    "build/iwer.module.js",
                ),
            ),
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
    return value
        ? value
              .split(",")
              .map((version) => version.trim())
              .filter(Boolean)
        : null;
}

function writeAssetManifest() {
    const repo = path.resolve(
        process.env.KHR_INTERACTIVITY_SAMPLE_ASSETS ??
            path.join(packageRoot, "../../../glTF-Test-Assets-Interactivity"),
    );
    const root = path.join(repo, "Tests/Interactivity");
    const cases = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (file.includes("/test-Json/") && file.endsWith(".json")) {
                const metadata = JSON.parse(fs.readFileSync(file, "utf8"));
                const base = path.dirname(path.dirname(file));
                cases.push({
                    name: path.relative(root, base),
                    url: rawFsUrl(
                        path.join(base, "glTF-Binary", metadata.glbFileName),
                    ),
                    metadata,
                });
            }
        }
    }
    walk(root);
    const overview = JSON.parse(
        fs.readFileSync(path.join(root, "Overview.json"), "utf8"),
    );
    cases.push({
        name: "Overview",
        url: rawFsUrl(path.join(root, overview.glbFileName)),
        metadata: overview,
    });
    const invalid = JSON.parse(
        fs.readFileSync(path.join(root, "invalid/invalid-index.json"), "utf8"),
    ).map((entry) => ({
        ...entry,
        url: rawFsUrl(path.join(root, entry.name, entry.variants.glTF)),
    }));
    const modelRoot = path.join(repo, "Models");
    const models = JSON.parse(
        fs.readFileSync(path.join(modelRoot, "model-index.json"), "utf8"),
    ).flatMap((entry) =>
        ["glTF", "glTF-Binary"]
            .filter((variant) => entry.variants[variant])
            .map((variant) => ({
                name: `Models/${entry.name}/${variant}`,
                url: rawFsUrl(
                    path.join(
                        modelRoot,
                        entry.name,
                        variant,
                        entry.variants[variant],
                    ),
                ),
            })),
    );
    const target = path.join(packageRoot, ".cache/assets-manifest.json");
    fs.writeFileSync(
        target,
        JSON.stringify(
            {
                revision: execFileSync("git", ["rev-parse", "HEAD"], {
                    cwd: repo,
                    encoding: "utf8",
                }).trim(),
                cases: cases.sort((a, b) => a.name.localeCompare(b.name)),
                invalid,
                models,
            },
            null,
            2,
        ),
    );
    return rawFsUrl(target);
}
