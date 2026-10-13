# gltf-interactivity-script

Compile JavaScript authoring programs into standalone `KHR_interactivity` GLBs. The package contains the structured numeric compiler extracted from Mini Chess and a typed build-time graph API for every operation in the repository's catalogue. It has no renderer dependency. Three and Needle consume the resulting asset through `three-gltf-interactivity`.

## Author and check

```sh
gltf-interactivity-script catalog --op math/transform
gltf-interactivity-script check examples/click-hover/main.source.js --scene examples/_shared/panel.gltf --json
gltf-interactivity-script compile examples/click-hover/main.source.js --scene examples/_shared/panel.gltf --out interaction.glb --json
gltf-interactivity-script compile examples/surface-cursor/main.graph.mjs --scene examples/_shared/panel.gltf --out cursor.glb --json
```

`check` compiles and validates without writing an output. `--json` prints one success object on stdout, or a structured diagnostic on stderr and exits nonzero. Diagnostics have stable codes and include the operation, socket, expected type and actual type where applicable. Source syntax errors include a one-based line and column. Unknown options, duplicate options, unknown sockets and configuration typos fail explicitly.

Use `.source.js` for runtime numeric logic and `.graph.mjs` for direct access to the native primitives. Graph modules run as ordinary JavaScript at build time. Both produce standard graph operations, with no JavaScript embedded in the player.

## Structured source

The numeric subset supports function-scoped `var`, named functions, fixed arrays, assignment, arithmetic and bitwise operators, conditions, loops, break/continue and bounded recursion. `Math` scalar operations and constants are supported where represented by the catalogue; `math` provides the scalar primitive names directly. Native vector/matrix operations and asynchronous flows are available through the graph API.

Import the authoring declarations through a triple-slash reference:

```js
/// <reference types="gltf-interactivity-script/globals" />
var target = scene.node("Target");
function click() {
  scene.setTranslation(target, Math.sin(1), 0, 0);
}
events.onSelect(target, click, []);
```

Scene methods are `setTranslation`, `setRotation` (x, y, z, w quaternion), `setScale`, `getVisible`, `setVisible`, and `get/setFloat`, `get/setInt`, `get/setBool`. Generic setters take `(path, value, ...indices)`. Paths and node names are static strings. Runtime values stay numeric.

Events cover startup, frame ticks, selection, hover and custom numeric payloads. Custom event socket names come from handler parameter names. Normal callbacks enter a bounded FIFO; coalescing keeps the newest job in a named group. Reset can clear queued callbacks. Callbacks execute synchronously by default; opt into cooperative work to resume them across frames.

Arrays have fixed storage per source site and a default capacity of 256 cells. Recursion is bounded to 24 activations within a recursive component. CLI flags `--array-capacity` and `--max-depth` configure those bounds. Objects other than static event payloads, closures, dynamic allocation, strings as runtime data, arbitrary library calls and asynchronous JavaScript are outside this subset.

## Typed native graph API

```js
import { defineGraph } from "gltf-interactivity-script";

export default defineGraph(({ g, node }) => {
  const selected = g.ops.event.onSelect({}, { nodeIndex: node("Target") });
  const cursor = g.write(
    "float3",
    "/nodes/[cursor]/translation",
    selected.outputs.selectionPoint,
    { cursor: g.int(node("Cursor")) },
  );
  selected.flow().to(cursor);
});
```

`g.ops.<domain>.<operation>(inputs, configuration, options)` mirrors catalogue names and socket names. Inputs use explicit typed values: `float`, `int`, `bool`, `ref`, vectors and matrices. Outputs are named handles. Connect flow sockets explicitly; `out` and `in` are defaults when present. `g.sequence(...)` fans out in order. `g.variable`, `g.get` and `g.set` manage typed state. `g.event`, `g.receive` and `g.send` retain the declared payload types. The API checks ownership, required sockets, grouped types and matrix/vector dimension pairings.

Generated declarations require TypeScript 5.4 or newer. The catalogue covers all 143 current operations, including the physics extension operations. Authoring a physics graph does not install a physics implementation: its host must support the defining extension. Representative examples execute on our Khronos core and Three integration; API coverage does not imply every host capability was exercised.

## Formatted examples

| Example | Demonstrates |
| --- | --- |
| [cooperative-motion](examples/cooperative-motion/README.md) | Sliced computation, responsive hover interpolation and outbound payloads |
| [click-hover](examples/click-hover/README.md) | Numeric state, scalar math, hover coalescing and reset |
| [surface-cursor](examples/surface-cursor/README.md) | Selection-point payload, float3 property writes and ref state |
| [matrix-transform](examples/matrix-transform/README.md) | TRS composition, homogeneous transform and component extraction |
| [timed-animation](examples/timed-animation/README.md) | Timer references, cancellation, animation playback and completion |
| [grid-navigation](examples/grid-navigation/README.md) | FPS movement, fixed tile-map collision and bounded hitscan |

Each example has its own folder with a formatted authoring program and README. Grid navigation also owns its scene. The small examples reuse `_shared/panel.gltf`; the shared viewer lives in `_shared`. [Example index and build instructions](examples/README.md). The viewer translates input into events; movement, collision and hitscan run in the generated graph.

The grid example is a small step toward a Doom port. A complete port still needs larger data sets, more compiler optimization and a strategy for rendering and loading game resources. No Doom performance or compatibility claim is made.

## Package API and development

`compile(source, options)` returns the graph, output asset, statistics and `toGLB()`. `compileGraph(author, options)` does the same for a native authoring function. Inputs can be a GLB `Asset` or a glTF document with one embedded buffer. The `/reference` export exposes the numeric IR and VM for differential tests; production files use the structured backend.

```sh
npm run generate   # regenerate catalogue and typed primitive wrappers
npm test
npm run typecheck
npm pack
```

The updated Khronos core is a normal dependency. Until core 1.1 is published, install its packed artifact alongside this package through normal npm resolution. Never copy package files into a consumer's node_modules. Generated catalogue/type files are shipped product source; caches, benchmark output, tarballs and browser results are excluded.

## Verification

The package tests run generated operations on the actual core, compare structured programs with the IR oracle, and check strict consumer declarations. `scripts/test-examples.mjs /path/to/consumer` checks the example GLBs in a browser: selection coordinates and references, matrix transforms, timer completion/cancellation, animation completion, grid collision/hitscan/reset and hover/click. The consumer must install the packed compiler, packed core, integration, Three, Vite and Playwright normally. Run `scripts/build-examples.mjs /path/to/consumer` first to compile the installed packed examples into `consumer/examples/<name>/example.glb` and copy the shared viewer. Serve the consumer at `EXAMPLES_URL` (default `http://127.0.0.1:5328`); `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium.

Compiler passes specialize constant arguments, share terminal function contexts, remove unused internal stores/state, fuse ordered writes, and hoist expensive invariant arithmetic. Globals and callback state stay observable. `compile(source, { optimize: false })` disables the newer passes for file comparisons. Short unknown-bound loops do not hoist cheap arithmetic. No runtime changes are needed to consume these optimizations.

## Cooperative work, interpolation and outbound events

See [the formatted cooperative-motion example](examples/cooperative-motion/main.source.js). `compile(source, {scene, cooperative: {stepsPerTick: 64, stackCapacity: 512}})` or CLI `--steps-per-tick 64` slices optimized structured control across ticks. Ordinary branches/writes keep native links, small innermost loops execute bounded native batches, and function entries remain yield points. Statically known returns link directly; only shared call sites use the bounded continuation stack in glTF memory pages. Expressions and recursive activation locals remain intact. This opt-in mode emits standard nodes and needs no runtime extension. It adds dispatch overhead and increases graph size.

`events.onFrame(functionName)` runs every tick with `(timeSinceStart, timeSinceLastTick)`, including while a normal callback is suspended. `{immediate: true}` runs small input callbacks independently with private activation locals. Normal callbacks retain the 32-job FIFO; `{interrupt: true}` cancels the current continuation and queued work before launching its replacement. Keep frame/immediate callbacks short and avoid mutating shared computation data while it is suspended.

```js
scene.interpolateTranslation(node, x, y, z, .2);
scene.interpolateRotation(node, qx, qy, qz, qw, .2);
scene.interpolateScale(node, sx, sy, sz, .2);
events.send('app:move', {from: 85, to: 65, ply: 1});
```

Interpolation lowers to `pointer/interpolate` with ease-in/out control points. Event IDs and payload keys must be static; numeric/bool expressions become float payload sockets. The engine emits `KHR_INTERACTIVITY:app:move` with the payload in `event.detail`. The reference VM records these in `sentEvents`; it treats interpolation as a final pose for comparison, without simulating time.

The optional `interactivity-script:budget` event accepts `{steps: int}` clamped to 1–65536. Metadata exposes the cooperative state, stack depth, step limit, steps used and slice count. Tick delta is a frame timestamp, not a CPU stopwatch. Hosts requiring a time budget should measure actual tick duration and adjust the quantum; the default fixed quantum bounds work, not milliseconds.

Scene transform components are read through the whole typed vector and standard extraction nodes:

```js
var target = scene.node('Target');
function frame(time, delta) {
  var height = scene.getTranslationY(target);
  var size = scene.getScaleX(target);
  scene.setBaseColor(0, 0, 0, 0, .5 / (1 + Math.max(0, height) * 2.8));
}
events.onFrame(frame);
```

`getTranslationX/Y/Z`, `getScaleX/Y/Z`, and `getRotationX/Y/Z/W` return numbers. `setBaseColor(material, r, g, b, a)` writes the complete float4 material factor. Vector object-model properties are atomic; numeric authoring should use these helpers rather than scalar pointer paths into individual components. `Asset.mesh` preserves two-component `uv` attributes as standard `TEXCOORD_0`, and RGB/RGBA `color` attributes as standard `COLOR_0`; RGBA vertex alpha supports soft unlit footprints without textures or renderer-specific shaders.

### Await and automatic scheduling

Structured source now supports a deliberately bounded async subset:

```js
async function calculate(count) {
  var sum = 0;
  for (var i = 0; i < count; i++) sum += Math.sqrt(i);
  await tasks.nextFrame();
  return sum;
}
async function main() {
  var result = await calculate(4000);
  events.send("done", { result: result });
  await tasks.sleep(0.25);
}
```

Declaring an async function automatically enables cooperative slicing (default 64 steps per tick, configurable through `cooperative`). Ordinary numeric helper calls and loop iterations share that budget. `await` specifies a wait; it is independent of automatic computation slicing. Both mechanisms are compiled into standard graph nodes and work without a JavaScript scheduler in the player.

- `await tasks.nextFrame()` resumes on a strictly later scheduler tick.
- `await tasks.sleep(seconds)` resumes on a later tick at or after its graph-timeline deadline. Zero also waits one tick. Negative, NaN and infinite durations terminate the job with the exposed fault flag.
- `await helper(args)` requires a directly named async helper. Its numeric result can be used in expressions, assignments, arguments, returns and nested/recursive calls. Even a helper without a wait has a later-tick await continuation.

The scheduler runs one normal job at a time, retaining the 32-job FIFO while it waits. It begins/resumes normal work at the central tick entry, replenishing the computation budget exactly once per tick. Start and interrupt callbacks install a job for that scheduler; they do not immediately execute source instructions. Small synchronous `onFrame` and `{immediate: true}` callbacks run independently, outside this work budget, with private activation locals. Keep them bounded. Shared globals/scene data remain shared, but values evaluated before suspension are snapshotted to preserve expression order. Mutable arrays declared inside a helper cannot be used by both scheduled and frame/immediate paths; compilation rejects that storage collision.

`{interrupt: true}` discards the parked continuation, its call stack, and queued jobs, and starts a replacement; it also clears the fault flag. Timeline waits have no native timer completion callbacks, so cancellation and immediate reuse cannot receive a stale completion. A fault terminates the active job; the fault flag remains set until interrupt/reset. This release does not implement `throw`, `try` or promise rejection values.

This is a frame-scheduled source subset, not JavaScript Promise equivalence. Promise objects, `.then`, `Promise.all`, floating async calls and concurrent `spawn`/`join` are unsupported. Frame/immediate callbacks must be synchronous. Native `scene.interpolate*` remains fire-and-forget; it cannot be awaited because replacement/cancellation does not yet guarantee a completion identity. Sleeping for an animation's duration is a timeline wait, not an animation-completion guarantee. The synchronous reference VM explicitly rejects async programs; test them using the emitted graph and actual engine.

See the formatted [await results example](examples/await-results/README.md) for sliced calculation, independent presentation, outbound results and interrupt/restart. Tick time is a frame timestamp, so this budget bounds graph work rather than guaranteeing a CPU duration in milliseconds.

### Compose source programs with native vector behavior

Pass an existing graph to `GraphBuilder` to add typed primitive behavior after source compilation. The builder clones the graph and preserves existing variable/event indices, so compiler metadata remains valid. Use the graph returned by `finish()` when packing the asset; node indices may change during ordering.

```js
import { compile, GraphBuilder } from 'gltf-interactivity-script';

const compiled = compile(source, { scene });
const g = new GraphBuilder({ graph: compiled.graph, optimize: false });
const position = g.pointer('float3', '/nodes/4/translation');
const components = g.ops.math.extract3({ a: position }).outputs;
const footprint = g.ops.math.combine3({
  a: components['0'],
  b: g.float(0.052),
  c: components['2'],
}).outputs.value;
g.ops.event.onTick().flow().to(
  g.write('float3', '/nodes/5/translation', footprint),
);
compiled.asset.doc.extensions.KHR_interactivity.graphs[0] = g.finish();
const glb = compiled.asset.pack();
```

This is useful for transform-following effects: keep whole vectors in typed variables, compare them with `math/eq`, and branch around unchanged writes. The source program and the added behavior both export ordinary KHR_interactivity nodes.
