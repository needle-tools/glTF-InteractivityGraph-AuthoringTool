/// <reference types="gltf-interactivity-script/globals" />
var panel = scene.node("Target");
var frames = 0, result = 0, completed = 0;

// Calls and loop iterations are sliced automatically; await controls timing.
async function calculate(count) {
  var sum = 0;
  for (var i = 0; i < count; i++) sum += Math.sqrt(i);
  await tasks.nextFrame();
  return sum;
}

async function start() {
  completed = 0;
  result = await calculate(4000);
  events.send("calculation:done", { result: result, frames: frames });
  await tasks.sleep(0.25);
  completed = 1;
}

// This small synchronous callback keeps presentation responsive while waiting.
function frame(time, delta) {
  frames++;
  scene.setTranslation(panel, Math.sin(time) * 0.4, 0, -2);
}

// Interrupt cancels the active continuation and queued jobs before restarting.
events.onStart(start);
events.onFrame(frame);
events.onReceive("restart", start, [], { interrupt: true });
