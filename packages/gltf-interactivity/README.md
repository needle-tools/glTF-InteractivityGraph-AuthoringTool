# three-gltf-interactivity

Play interactive glTF models in Three.js and Needle Engine with `KHR_interactivity`.
Graphs start automatically when a model loads.

## Three.js

```sh
npm install three-gltf-interactivity three
```

Add the plugin to your loader, then load a model into your scene:

```ts
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { registerGLTFInteractivity, getInteractivityRuntime } from "three-gltf-interactivity";

const loader = new GLTFLoader();
const unregister = registerGLTFInteractivity(loader, {
  onReady(runtime) {
    runtime.setCamera(camera);
    runtime.attachPointerEvents(renderer.domElement);
  },
});

const gltf = await loader.loadAsync("/interactive.glb");
scene.add(gltf.scene);
```

Use your app’s `scene`, `camera`, and `renderer`. `onReady` lets you configure
input before the graph starts. The plugin also supports `KHR_animation_pointer`.

## Needle Engine

In a Needle project, install the package:

```sh
npm install three-gltf-interactivity
```

Register it before loading your model:

```ts
import "@needle-tools/engine";
import { registerNeedleInteractivity } from "three-gltf-interactivity/needle";

registerNeedleInteractivity();

const engine = document.createElement("needle-engine");
engine.setAttribute("src", "/interactive.glb");
document.body.append(engine);
```

Needle handles the camera, pointer input, XR input, and runtime cleanup for you.
Set `pointerEvents: false` if you want to handle input yourself.

### Share Three with Needle

In `package.json`, set `three` to the alias used by your Needle Engine version.
You can look up that alias with:

```sh
npm view @needle-tools/engine@YOUR_VERSION dependencies.three
```

For Vite projects, add `dedupe` to your existing configuration:

```js
export default {
  resolve: { dedupe: ["three"] },
};
```

This keeps the app, Needle, and the plugin using the same Three instance.

## Options

Both registration helpers accept:

| Option | Default | Description |
| --- | --- | --- |
| `autoStart` | `true` | Start the model's graph when loading finishes. |
| `onReady` | — | Configure the runtime before it starts. Supports async callbacks. |
| `fps` | `60` | Graph tick rate. |
| `eventBus` | DOM event bus | Use your own custom event bus. |
| `initializeWithoutExtension` | `false` | Create a runtime for a model without an embedded graph. |

To start the model's graph yourself:

```ts
import { getInteractivityRuntime } from "three-gltf-interactivity";

registerGLTFInteractivity(loader, { autoStart: false });
const gltf = await loader.loadAsync("/model.glb");
getInteractivityRuntime(gltf)?.start();
```

## Custom events

Send an event declared by your model's graph using its ID:

```ts
const runtime = getInteractivityRuntime(gltf);
runtime?.sendEvent("toggle-animation", { enabled: true });
```

Unknown event IDs throw an error.

## Cleanup

When removing a Three.js model, dispose its runtime:

```ts
getInteractivityRuntime(gltf)?.dispose();
```

This stops graph and animation updates and removes input listeners. Dispose the
model's geometry, materials, and textures as you normally would in Three.js.

Call `unregister()` when you want to stop adding interactivity to future loads.

## Support

Supports desktop interaction and Needle's WebXR input. Optional rigid-body
operations are not supported.

## Contributing

See the [development and testing guide](test/matrix/README.md).
