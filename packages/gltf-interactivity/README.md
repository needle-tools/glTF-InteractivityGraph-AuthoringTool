# @needle-tools/gltf-interactivity

`KHR_interactivity` runtime integration for Three.js `GLTFLoader` and Needle Engine 6.

The package creates the interactivity runtime as part of glTF loading. A model starts when loading completes; no second parse, post-load graph reconstruction, or Play button is required.

## Install

For Three.js:

```sh
npm install @needle-tools/gltf-interactivity three
```

For Needle Engine:

```sh
npm install @needle-tools/gltf-interactivity @needle-tools/engine
```

## Three.js

Register the plugin before loading a glTF or GLB. The helper also registers `KHR_animation_pointer` support.

```ts
import { registerGLTFInteractivity } from "@needle-tools/gltf-interactivity";
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
import { getInteractivityRuntime } from "@needle-tools/gltf-interactivity";

const runtime = getInteractivityRuntime(gltf);
runtime?.dispose();
```

Disposing a runtime stops graph and animation updates and removes input listeners. Dispose the model's geometry, materials, and textures according to the owning application's normal Three.js lifecycle.

## Needle Engine 6

Register the extension before assigning a source to `<needle-engine>` or otherwise starting a glTF load:

```ts
import "@needle-tools/engine";
import { registerNeedleInteractivity } from "@needle-tools/gltf-interactivity/needle";

registerNeedleInteractivity();

const engine = document.createElement("needle-engine");
engine.setAttribute("src", "/interactive.glb");
document.body.append(engine);
```

Needle registration uses `addCustomExtensionPlugin` and installs the Three loader plugin in `onImport`. It uses Needle's existing `KHR_animation_pointer` registration, frame update, active camera, physics raycast, and context cleanup. It does not load or rebuild the model after Needle has finished.

Needle Engine 6 currently uses its own Three.js distribution. Applications that also declare `three` should resolve it to the same package instance, for example:

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
| `fps` | `60` | Tick rate used by standalone Three.js animation updates. |
| `eventBus` | DOM event bus | Supply an application-specific custom event bus. |

Needle also supports `pointerEvents: false` to opt out of its selection and hover adapter. Needle drives animation playback through its frame lifecycle; `fps` continues to control the graph tick rate.

For an authoring workflow, disable automatic start and start an edited graph explicitly:

```ts
registerGLTFInteractivity(loader, { autoStart: false });
const gltf = await loader.loadAsync("/model.glb");
getInteractivityRuntime(gltf)?.start(authoredGraph);
```

## Development

From this package directory:

```sh
npm run build
npm run pack:check
```

The consumer projects in `examples/three` and `examples/needle` load the same interactive fixture through the public package entry points. Build the package before installing or running either local example.
