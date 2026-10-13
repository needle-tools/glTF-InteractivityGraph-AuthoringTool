# Development and testing

## Setup

From the repository root:

```sh
npm ci --legacy-peer-deps
npm --prefix packages/gltf-interactivity ci --legacy-peer-deps
cd packages/gltf-interactivity
npm run build
```

Development installs use `--legacy-peer-deps` for the SDK's prerelease peers.
Production consumers use normal dependency resolution and the SDK's Three alias.

## Run the matrix

From `packages/gltf-interactivity`:

```sh
npx playwright install chromium
npm run test:matrix
```

Tests use the adjacent `glTF-Test-Assets-Interactivity` checkout. Update it from
Khronos main, or set `KHR_INTERACTIVITY_SAMPLE_ASSETS` to another clean checkout.

The suite installs a fresh package tarball into Three and Needle consumers,
checks public imports and types, builds production apps, and exercises the
models in Chromium. Three declarations use strict NodeNext checking; Needle
consumers use bundler resolution and skip SDK declaration checks.

Smoke tests cover the default Three milestones and latest release, plus stable
and latest Needle in module and distribution form. The full asset corpus runs
on latest Three and stable/latest Needle modules. IWER runs four AR/VR
controller and hand profiles on latest Needle. Physical headsets are not covered
by this suite.

## Results

- `.cache/packed-consumer.json`: tarball, checksum, source revision, and consumer dependencies.
- `.cache/coverage.json`: operation presence in the asset corpus.
- `.cache/matrix-report.json` and `.cache/matrix-report.md`: aggregate results.
- `test-results/`: Playwright attachments.

Operation presence is not exhaustive spec coverage. Filtered runs are useful
for debugging; use an unfiltered run for release verification.

## Configuration

| Variable | Purpose |
| --- | --- |
| `THREE_MATRIX_VERSIONS` / `NEEDLE_MATRIX_VERSIONS` | Comma-separated exact versions. |
| `MATRIX_WORKERS` | Browser workers; default 2. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Use an existing Chromium executable. |
| `MATRIX_TEST_PORT` / `REUSE_MATRIX_SERVER=1` | Configure or reuse the test server. |
| `CONFORMANCE_RUNTIME_FILTER` / `CONFORMANCE_FILTER` | Filter corpus tests. |
| `XR_RUNTIME_FILTER` / `XR_CASE_FILTER` | Filter XR tests. |

## Release checks

1. Finalize the version and changelog.
2. Run the complete matrix and review failures and incomplete runs.
3. Publish the exact tested tarball after checking npm access:

   ```sh
   npm publish /path/to/three-gltf-interactivity-0.1.0.tgz --access public --dry-run
   npm publish /path/to/three-gltf-interactivity-0.1.0.tgz --access public
   ```

4. Verify clean Three and Needle installations, then tag the tested commit.

Rebuild, repack, and rerun after source or schema changes. Bundled core
provenance is recorded in `dist/bundled-core.json`.

## Schema generation

From the repository root, using a current Khronos glTF checkout:

```sh
KHR_INTERACTIVITY_GLTF_REPO=/path/to/glTF node scripts/generate-object-model-schema.mjs
KHR_INTERACTIVITY_GLTF_REPO=/path/to/glTF node scripts/generate-runtime-schema.mjs
```
