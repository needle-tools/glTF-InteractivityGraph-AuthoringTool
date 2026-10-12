# Examples

Each example owns its authoring program and instructions. Shared files are in `_shared`; generated GLBs stay in the consumer.

| Folder | Program | Scene |
| --- | --- | --- |
| [click-hover](click-hover/README.md) | `main.source.js` | `_shared/panel.gltf` |
| [surface-cursor](surface-cursor/README.md) | `main.graph.mjs` | `_shared/panel.gltf` |
| [matrix-transform](matrix-transform/README.md) | `main.graph.mjs` | `_shared/panel.gltf` |
| [timed-animation](timed-animation/README.md) | `main.graph.mjs` | `_shared/panel.gltf` |
| [grid-navigation](grid-navigation/README.md) | `main.source.js` | `grid-navigation/scene.gltf` |

Install the packed compiler, core, integration, Three, Vite and Playwright in a consumer. From this package directory, run:

```sh
npm run build:examples -- /path/to/consumer
```

Serve the consumer with Vite. Open `/examples/_shared/viewer.html?asset=../grid-navigation/example.glb`, substituting another folder name to switch examples. The compiler sources and scene are read from the installed package, and each output is written to `consumer/examples/<name>/example.glb`.

To check the browser behaviors:

```sh
EXAMPLES_URL=http://127.0.0.1:5328 npm run test:examples -- /path/to/consumer
```

[Cooperative motion](cooperative-motion/README.md) demonstrates sliced computation, immediate hover, `pointer/interpolate` and outbound event payloads. Its index entry supplies `stepsPerTick: 32` to the packed example builder.
