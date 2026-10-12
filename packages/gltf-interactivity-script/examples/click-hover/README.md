# Click and hover

Hover and click the quad. The graph updates hover state and the click count; a `reset` event clears the state.

Files: [main.source.js](main.source.js) and [../_shared/panel.gltf](../_shared/panel.gltf). Run from the package directory:

```sh
mkdir -p .cache/click-hover
node src/cli.mjs check examples/click-hover/main.source.js --scene examples/_shared/panel.gltf --json
node src/cli.mjs compile examples/click-hover/main.source.js --scene examples/_shared/panel.gltf --out .cache/click-hover/example.glb --json
```

For the shared viewer and browser checks, use the [example build instructions](../README.md). The packed-example build puts this GLB in `consumer/examples/click-hover/example.glb`; open `/examples/_shared/viewer.html?asset=../click-hover/example.glb`.
