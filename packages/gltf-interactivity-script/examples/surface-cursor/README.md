# Surface cursor

Click different points on the quad. The cursor moves to the actual selection point, and the `selected node` reference records the selected target.

Files: [main.graph.mjs](main.graph.mjs) and [../_shared/panel.gltf](../_shared/panel.gltf). Run from the package directory:

```sh
mkdir -p .cache/surface-cursor
node src/cli.mjs check examples/surface-cursor/main.graph.mjs --scene examples/_shared/panel.gltf --json
node src/cli.mjs compile examples/surface-cursor/main.graph.mjs --scene examples/_shared/panel.gltf --out .cache/surface-cursor/example.glb --json
```

For the shared viewer and browser checks, use the [example build instructions](../README.md). The packed-example build puts this GLB in `consumer/examples/surface-cursor/example.glb`; open `/examples/_shared/viewer.html?asset=../surface-cursor/example.glb`.
