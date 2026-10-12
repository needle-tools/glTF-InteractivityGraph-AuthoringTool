/// <reference types="gltf-interactivity-script/globals" />
var target = scene.node("Target");
var clicks = 0;
function start() {
  clicks = 0;
  scene.setTranslation(target, 0, 0, 0);
  scene.setScale(target, 1, 1, 1);
}
function select() {
  clicks++;
  scene.setTranslation(target, Math.sin(clicks), 0, 0);
}
function enter() {
  scene.setScale(target, 1.1, 1.1, 1.1);
}
function leave() {
  scene.setScale(target, 1, 1, 1);
}
events.onStart(start);
events.onSelect(target, select, []);
events.onHoverIn(target, enter, [], { coalesce: "target hover" });
events.onHoverOut(target, leave, [], { coalesce: "target hover" });
events.onReceive("reset", start, [], { interrupt: true });
