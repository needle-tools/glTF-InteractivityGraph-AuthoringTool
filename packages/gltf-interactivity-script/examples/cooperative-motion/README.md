# Cooperative motion

A long numeric loop runs in slices while hover starts native `pointer/interpolate` motion immediately. A custom `calculation:done` event reports the result and frame count. No JavaScript runs in the player.

```sh
gltf-interactivity-script compile main.source.js --scene ../_shared/panel.gltf --steps-per-tick 32 --out example.glb --json
```

Use `compile(source, {scene, cooperative: {stepsPerTick: 32}})` from the package API. Each tick uses at most 32 work units: native loop iterations and resumed call/return regions. Ordinary branches and writes retain native flow links. The independent `onFrame(time, delta)` callback and explicitly immediate hover callbacks keep running while the computation is suspended. Keep these callbacks small, and do not mutate the search's private data from them.

An optional host feedback loop can send `interactivity-script:budget` with `{steps: int}` (1–65536). Tick time/delta are frame timestamps, not a live CPU clock; a fixed quantum cannot promise a millisecond deadline. Measure actual tick time in the host when a time budget is needed.
