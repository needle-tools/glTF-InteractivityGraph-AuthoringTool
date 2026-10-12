# gltf-interactivity-script

Compile JavaScript authoring programs into standalone `KHR_interactivity` GLBs. The package contains the structured numeric compiler extracted from Mini Chess and a typed build-time graph API for every operation in the repository's catalogue. It has no renderer dependency. Three and Needle consume the resulting asset through `three-gltf-interactivity`.

## Author and check

```sh
gltf-interactivity-script catalog --op math/transform
gltf-interactivity-script check examples/click-hover.source.js --scene examples/scene.gltf --json
gltf-interactivity-script compile examples/click-hover.source.js --scene examples/scene.gltf --out interaction.glb --json
gltf-interactivity-script compile examples/surface-cursor.graph.mjs --scene examples/scene.gltf --out cursor.glb --json
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

Scene methods are `setTranslation`, `setScale`, `getVisible`, `setVisible`, and `get/setFloat`, `get/setInt`, `get/setBool`. Generic setters take `(path, value, ...indices)`. Paths and node names are static strings. Runtime values stay numeric.

Events cover startup, frame ticks, selection, hover and custom numeric payloads. Custom event socket names come from handler parameter names. Normal callbacks enter a bounded FIFO; coalescing keeps the newest job in a named group. Reset can clear queued callbacks. Each callback executes synchronously to completion.

Arrays have fixed storage per source site and a default capacity of 256 cells. Recursion is bounded to 24 activations within a recursive component. CLI flags `--array-capacity` and `--max-depth` configure those bounds. Objects, closures, dynamic allocation, strings as runtime data, arbitrary library calls and asynchronous JavaScript are outside this subset.

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

| Example                      | Demonstrates                                                               |
| ---------------------------- | -------------------------------------------------------------------------- |
| `click-hover.source.js`      | Numeric state, scalar math, hover coalescing and reset                     |
| `surface-cursor.graph.mjs`   | Real selection-point payload, float3 property writes and ref state         |
| `matrix-transform.graph.mjs` | TRS composition, homogeneous matrix transform and component extraction     |
| `timed-animation.graph.mjs`  | Timer references, cancellation, animation playback and completion          |
| `grid-navigation.source.js`  | FPS movement, collision against a fixed tile map and a bounded hitscan ray |

The first four use `scene.gltf`; grid navigation uses `grid-scene.gltf`. Compile an example to a GLB, then open `viewer.html?asset=example.glb` in a consumer with Three and `three-gltf-interactivity` installed. The viewer translates input into events; movement, collision and hitscan run in the generated graph.

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

The package tests run generated operations on the actual core, compare structured programs with the IR oracle, and check strict consumer declarations. `scripts/test-examples.mjs /path/to/consumer` checks the example GLBs in a browser: selection coordinates and references, matrix transforms, timer completion/cancellation, animation completion, grid collision/hitscan/reset and hover/click. The consumer must install the packed compiler, packed core, integration, Three, Vite and Playwright normally. Serve the example viewer at `EXAMPLES_URL` (default `http://127.0.0.1:5328`); `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium.

Compiler passes specialize constant arguments, share terminal function contexts, remove unused internal stores/state, fuse ordered writes, and hoist expensive invariant arithmetic. Globals and callback state stay observable. `compile(source, { optimize: false })` disables the newer passes for file comparisons. Short unknown-bound loops do not hoist cheap arithmetic. No runtime changes are needed to consume these optimizations.
