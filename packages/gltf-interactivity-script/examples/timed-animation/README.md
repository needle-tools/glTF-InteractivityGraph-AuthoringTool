# Timer and animation

Click the quad. After a short delay, its animation plays and the `animation finished` variable becomes true. Send `window.example.send("cancel")` during the delay to cancel it; the timer token is a typed reference.

Files: [main.graph.mjs](main.graph.mjs) and [../_shared/panel.gltf](../_shared/panel.gltf). Run from the package directory:

```sh
mkdir -p .cache/timed-animation
node src/cli.mjs check examples/timed-animation/main.graph.mjs --scene examples/_shared/panel.gltf --json
node src/cli.mjs compile examples/timed-animation/main.graph.mjs --scene examples/_shared/panel.gltf --out .cache/timed-animation/example.glb --json
```

For the shared viewer and browser checks, use the [example build instructions](../README.md). The packed-example build puts this GLB in `consumer/examples/timed-animation/example.glb`; open `/examples/_shared/viewer.html?asset=../timed-animation/example.glb`.
