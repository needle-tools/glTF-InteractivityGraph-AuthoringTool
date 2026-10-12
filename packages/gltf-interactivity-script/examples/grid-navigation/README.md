# Grid navigation

Use W/S to move, A/D to turn, Q/E to strafe, Space to fire and R to reset. Movement follows the camera; collision and bounded hitscan execute in the graph against the fixed tile map.

Files: [main.source.js](main.source.js) and [scene.gltf](scene.gltf). Run from the package directory:

```sh
mkdir -p .cache/grid-navigation
node src/cli.mjs check examples/grid-navigation/main.source.js --scene examples/grid-navigation/scene.gltf --json
node src/cli.mjs compile examples/grid-navigation/main.source.js --scene examples/grid-navigation/scene.gltf --out .cache/grid-navigation/example.glb --json
```

For the shared viewer and browser checks, use the [example build instructions](../README.md). The packed-example build puts this GLB in `consumer/examples/grid-navigation/example.glb`; open `/examples/_shared/viewer.html?asset=../grid-navigation/example.glb`.
