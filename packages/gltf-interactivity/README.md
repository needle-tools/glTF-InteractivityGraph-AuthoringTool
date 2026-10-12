# three-gltf-interactivity

`KHR_interactivity` runtime integration for Three.js `GLTFLoader` and Needle Engine.

The package creates the interactivity runtime as part of glTF loading. A model starts when loading completes; no second parse, post-load graph reconstruction, or Play button is required.

## Install

For Three.js:

```sh
npm install three-gltf-interactivity three
```

For Needle Engine:

```sh
npm install three-gltf-interactivity @needle-tools/engine
```

## Three.js

Register the plugin before loading a glTF or GLB. The helper also registers `KHR_animation_pointer` support.

```ts
import { registerGLTFInteractivity } from "three-gltf-interactivity";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
registerGLTFInteractivity(loader, {
  onReady(runtime) {
    runtime.setCamera(camera);
    runtime.attachPointerEvents(renderer.domElement);
  },
});

const gltf = await loader.loadAsync("/interactive.glb");
scene.add(gltf.scene);
```

`onReady` runs before the graph's `event/onStart`, so camera and pointer input are available to the graph from its first event.

The registration function returns an unregister callback. Runtime cleanup is separate because a loader can load more than one model:

```ts
import { getInteractivityRuntime } from "three-gltf-interactivity";

const runtime = getInteractivityRuntime(gltf);
runtime?.dispose();
```

Disposing a runtime stops graph and animation updates and removes input listeners. Dispose the model's geometry, materials, and textures according to the owning application's normal Three.js lifecycle.

## Needle Engine

Register the extension before assigning a source to `<needle-engine>` or otherwise starting a glTF load:

```ts
import "@needle-tools/engine";
import { registerNeedleInteractivity } from "three-gltf-interactivity/needle";

registerNeedleInteractivity();

const engine = document.createElement("needle-engine");
engine.setAttribute("src", "/interactive.glb");
document.body.append(engine);
```

Needle registration uses `addCustomExtensionPlugin` and installs the Three loader plugin in `onImport`. It uses Needle's existing `KHR_animation_pointer` registration, frame update, active camera, exact Three geometry raycasts, XR input sources, and context cleanup. It does not load or rebuild the model after Needle has finished.

Needle Engine uses its own Three.js distribution. Applications that also declare `three` should resolve it to the same package instance, for example:

```json
{
  "dependencies": {
    "@needle-tools/engine": "6.0.0-alpha",
    "three": "npm:@needle-tools/three@0.185.2-alpha.1"
  }
}
```

## Options

Both registration helpers accept these options:

| Option | Default | Purpose |
| --- | --- | --- |
| `autoStart` | `true` | Start the embedded active graph in `afterRoot`. |
| `initializeWithoutExtension` | `false` | Create a runtime for an authoring graph when the file has no `KHR_interactivity` extension. |
| `onReady` | none | Configure the runtime before automatic start. May be async. |
| `fps` | `60` | Graph tick rate. |
| `eventBus` | DOM event bus | Supply an application-specific custom event bus. |

Needle also supports `pointerEvents: false` to opt out of its desktop and XR selection and hover adapters. XR uses Needle controller world rays and native session selection events, including hand pinch input; camera pointers follow Needle’s XR camera. Needle uses the same elapsed-time animation clock as the graph; its SDK caps frame deltas, which would otherwise slow animations relative to graph timers under load. `fps` controls the graph tick rate.

For an authoring workflow, disable automatic start and start an edited graph explicitly:

```ts
registerGLTFInteractivity(loader, { autoStart: false });
const gltf = await loader.loadAsync("/model.glb");
getInteractivityRuntime(gltf)?.start(authoredGraph);
```

## Development

This is Needle's `three-gltf-interactivity` integration package, with a separate `three-gltf-interactivity/needle` entry point. The Khronos runtime is owned and released separately. The integration depends on `@khronosgroup/gltf-interactivity-engine@^1.1.0`; it does not bundle a second engine. The 1.1.0 candidate includes current Khronos main and correct ESM/declaration packaging. **Release the Khronos 1.1.0 package before publishing this integration.** Published 1.0.0 is insufficient for the current test corpus. Local verification installs both exact packed artifacts without publishing.

Bootstrap from the repository root (the package lock uses the adjacent core for development):

```sh
npm ci --legacy-peer-deps
npm --prefix src/BasicBehaveEngine ci
npm --prefix src/BasicBehaveEngine run build
npm --prefix packages/gltf-interactivity ci --legacy-peer-deps
cd packages/gltf-interactivity
npx playwright install chromium
npm run test:matrix
```

The development SDK has prerelease Three peer conflicts in its transitive dependencies, so development installation uses `--legacy-peer-deps` to retain its declared Three distribution. The packed production consumers install normally. Needle consumers should deduplicate `three` in their bundler (for Vite, `resolve: { dedupe: ["three"] }`) and use the exact Three dependency declared by their SDK release.

`test:matrix` builds and packs both packages into a fresh directory, installs the tarballs in real Three and Needle consumers, typechecks them, and runs production builds. Standalone declarations use strict NodeNext resolution with `skipLibCheck: false` and browser-only ambient types; Needle application checks use bundler resolution and skip upstream SDK declaration checking. Browsers import those installed tarballs.

`@needle-tools/three-test-matrix` supplies the runtime cache and import maps. Its default Three milestones (r169, r170, r175, r180, r184) plus latest receive quick loading/rendering smoke checks. Needle stable and latest receive smoke checks in both distribution and package-module form, with worker dependencies bundled against their own Three distribution. The complete fixture corpus runs only on latest Three and stable/latest Needle module consumers. Historical version sweeps are opt-in.

The asset corpus is read from the clean adjacent `../glTF-Test-Assets-Interactivity` repository; set `KHR_INTERACTIVITY_SAMPLE_ASSETS` to override it. Update that checkout from Khronos main before testing. Browser tests load every valid default graph, all invalid fixtures and all model variants through the real loaders. They check every metadata assertion, drive required select/hover cases using Playwright mouse input, and load both InterGlb files before starting their event queues. Invalid graphs must fail loading with a validation diagnostic.

IWER 2.5 and its synthetic environment module run real Needle WebXR sessions in Chromium. The four AR/VR controller/hand cases run once on latest Needle's module consumer, covering both hands, disabled ancestors, models loaded before and during XR, projection/camera pointers, disposal and session reentry. SEM provides AR hit testing. This emulates the XR API; physical headset behavior and other browsers still require device testing.

Results and artifact checksums are retained in `.cache/packed-consumer.json`, `.cache/coverage.json`, and Playwright `test-results/` attachments. `node test/matrix/report.mjs` produces an aggregate report after a complete run. The current corpus contains all 135 core operation names, but operation presence and passing fixtures do not prove exhaustive spec coverage. Optional rigid-body operations are not implemented by the shared Three/Needle decorator and are not advertised as supported.

Useful overrides:

- `THREE_MATRIX_VERSIONS` / `NEEDLE_MATRIX_VERSIONS`: comma-separated exact versions.
- `MATRIX_WORKERS`: concurrent browser workers (default 2).
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: use an existing compatible Chromium executable.
- `MATRIX_TEST_PORT` / `REUSE_MATRIX_SERVER=1`: run against an existing matrix server.
- `CONFORMANCE_RUNTIME_FILTER`, `CONFORMANCE_FILTER`, `XR_RUNTIME_FILTER`, `XR_CASE_FILTER`: focused debugging; these do not constitute a complete matrix run.

To regenerate spec metadata, clone current Khronos glTF main and run from the repository root:

```sh
KHR_INTERACTIVITY_GLTF_REPO=/path/to/glTF node scripts/generate-object-model-schema.mjs
KHR_INTERACTIVITY_GLTF_REPO=/path/to/glTF node scripts/generate-runtime-schema.mjs
```

## Host controls

Host controls can dispatch a graph's custom event by its declared ID:

```js
runtime.sendEvent("mini-chess:self-play", { enabled: true });
```

The runtime resolves the engine's event channel; callers do not construct an internal channel name. Unknown IDs throw. `runtime.setCamera(null)` exposes all active-camera fields as NaNs until another camera is assigned.

## Release

1. Submit the core validation, delay fixes and browser packaging changes to Khronos. A maintainer with access to the `@khronosgroup` npm package must publish engine 1.1.0. Confirm that `npm view @khronosgroup/gltf-interactivity-engine version` reports the required release.
2. Finalize the integration version and changelog, then run `npm run test:matrix`. This produces fresh tarballs, verifies public imports and production builds in minimum/latest Three and stable/latest Needle consumers, and runs the focused browser policy described above. The artifact paths, checksums and source revision are recorded in `.cache/packed-consumer.json`.
3. After the core is on npm, install the integration tarball into clean Three and Needle consumers with the core resolved from npm, without supplying the local core tarball. Repeat the public import, type and production-build checks to verify the published dependency chain. Keep the tested integration tarball for publication.
4. Log into the intended Needle npm publisher account. Check the package name is available (or that the account owns it), run `npm publish /absolute/path/three-gltf-interactivity-0.1.0.tgz --access public --dry-run`, then publish that same tarball with `--dry-run` removed. This publishes the integration; Khronos core publication is a separate release.
5. Add the intended Needle maintainers, verify `npm install three-gltf-interactivity` in a clean consumer, and tag the tested source revision as `three-gltf-interactivity-v0.1.0` with release notes.

The `0.1.0` scope covers the current core fixture corpus and Chromium/IWER XR emulation. Optional rigid-body operations remain unsupported, and physical headset testing is a separate release check before making device compatibility claims.

Repack and rerun after changing source or generated schemas. The source examples use the public package entry points; the matrix uses installed production artifacts rather than development links.
