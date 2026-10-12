# Matrix transform

On startup the graph composes a TRS matrix, transforms a homogeneous point, extracts its components and places the cursor at `[0.5, 0.4, 0]`.

Files: [main.graph.mjs](main.graph.mjs) and [../_shared/panel.gltf](../_shared/panel.gltf). Run from the package directory:

```sh
mkdir -p .cache/matrix-transform
node src/cli.mjs check examples/matrix-transform/main.graph.mjs --scene examples/_shared/panel.gltf --json
node src/cli.mjs compile examples/matrix-transform/main.graph.mjs --scene examples/_shared/panel.gltf --out .cache/matrix-transform/example.glb --json
```

For the shared viewer and browser checks, use the [example build instructions](../README.md). The packed-example build puts this GLB in `consumer/examples/matrix-transform/example.glb`; open `/examples/_shared/viewer.html?asset=../matrix-transform/example.glb`.
