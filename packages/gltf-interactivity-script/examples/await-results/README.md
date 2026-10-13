# Await results

`main.source.js` calculates a numeric result over many frames, awaits a helper result, emits `calculation:done`, waits another 0.25 timeline seconds, then marks completion. A synchronous frame callback moves the panel continuously while the calculation and waits progress. Send `restart` (or press R in the shared viewer) to cancel current/queued work and run it again.

The example builder uses 64 steps per tick. The emitted GLB contains the scheduler, computation, waits and result event as standard interactivity nodes. No JavaScript executes these behaviors in the player.

Compile from the installed package with `npm run build:examples -- /path/to/consumer`; open `/examples/_shared/viewer.html?asset=../await-results/example.glb`. For Needle, install `@needle-tools/engine` in the consumer and use `/examples/_shared/needle-viewer.html?asset=../await-results/example.glb`. Inspect `JS global result`, `completed` and `frames`, or listen for `KHR_INTERACTIVITY:calculation:done` with `{ result, frames }`.

`await tasks.nextFrame()` and `await tasks.sleep(seconds)` return numeric zero. Direct async helpers return numeric values. Normal jobs are serialized; presentation callbacks run independently. Promise objects, concurrent tasks and awaited native animation completion are outside this initial subset.

Run `EXAMPLES_URL=http://127.0.0.1:5328 npm run test:await-example -- /path/to/consumer` from this package directory to check the exact packed GLB in Three and Needle, including restart, result payloads, continued frame motion and slice budgets.
