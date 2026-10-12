/// <reference types="gltf-interactivity-script/globals" />
var panel = scene.node("Target");
var total = 0,
  completed = 0,
  frames = 0;

function calculate() {
  for (var i = 0; i < 4000; i++) total += Math.sqrt(i);
  completed = 1;
  events.send("calculation:done", { result: total, frames: frames });
}
function frame(time, delta) {
  frames++;
}
function enter() {
  scene.interpolateTranslation(panel, 0, 0.2, -2, 0.12);
}
function leave() {
  scene.interpolateTranslation(panel, 0, 0, -2, 0.12);
}
events.onStart(calculate);
events.onFrame(frame);
events.onHoverIn(panel, enter, [], { immediate: true });
events.onHoverOut(panel, leave, [], { immediate: true });
