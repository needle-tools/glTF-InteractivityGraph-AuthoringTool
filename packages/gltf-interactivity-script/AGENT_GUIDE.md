# Agent authoring workflow

1. Inspect the input scene's node names and indices. Use `scene.node` / `node` for stable unique names; do not guess indices.
2. Query `gltf-interactivity-script catalog --op domain/operation` for exact socket names, types, configurations and flow outputs.
3. Choose structured source for numeric algorithms. Use async functions for automatically sliced numeric work, directly awaited numeric helpers, `await tasks.nextFrame()` and `await tasks.sleep(seconds)`. Choose a graph module for vectors, matrices, references and native asynchronous flow.
4. Write a formatted, small example before expanding the program. Keep initialization, input handling and state updates explicit.
5. Run `check ... --scene ... --json`. Fix the reported operation/socket/type; do not bypass diagnostics with casts or invented socket names.
6. Compile to GLB. Execute representative events in the actual consumer and compare observable state with an independent reference.
7. Measure compiler improvements using both files on the same runtime. Track bytes, nodes, state variables and CPU time separately. Never count reduced search depth or removed behavior as an optimization.

Value and flow handles belong to one graph. A flow output has one target; use a sequence to fan out. Matrices use column-major components. `math/transform` requires matching vector/matrix dimensions; use a homogeneous float4 with a float4x4 matrix for a 3D point.

The catalogue includes extension-defined operations. Check the host capability before using them. Unknown runtime support is not proof of support.

Async source has one scheduled normal job plus synchronous frame/immediate presentation callbacks. Directly await async helper calls and use their numeric results; do not store Promise values or invent spawn/join APIs. Explicit waits control timing while computation slicing is automatic. Normal jobs remain FIFO; an interrupt cancels current and queued work. Native interpolation cannot be awaited. Write a tiny timing/result/reset example and test the emitted graph before expanding an async algorithm. See `examples/await-results`.
