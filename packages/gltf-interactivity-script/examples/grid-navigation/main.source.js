/// <reference types="gltf-interactivity-script/globals" />
// A small FPS movement/collision kernel. Host code supplies input, not game logic.
var player = scene.node("Player");
var cursor = scene.node("Cursor");
// prettier-ignore
var map = [
  1, 1, 1, 1, 1, 1, 1, 1, // row 0
  1, 0, 0, 0, 0, 0, 0, 1, // row 1
  1, 0, 1, 1, 0, 0, 0, 1, // row 2
  1, 0, 0, 0, 0, 1, 0, 1, // row 3
  1, 0, 0, 0, 0, 1, 0, 1, // row 4
  1, 0, 1, 0, 0, 0, 0, 1, // row 5
  1, 0, 0, 0, 0, 0, 0, 1, // row 6
  1, 1, 1, 1, 1, 1, 1, 1, // row 7
];
var x = 1.5,
  z = 1.5,
  yaw = 0,
  shots = 0,
  lastHit = 0;
/** @param {number} px @param {number} pz */
function blocked(px, pz) {
  if (px < 0.2 || pz < 0.2 || px >= 7.8 || pz >= 7.8) return 1;
  return map[Math.floor(pz) * 8 + Math.floor(px)];
}
function render() {
  scene.setTranslation(player, x, 0.8, z);
  scene.setRotation(player, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
}
function start() {
  x = 1.5;
  z = 1.5;
  yaw = -Math.PI / 2;
  shots = 0;
  render();
}
/** @param {number} forward @param {number} strafe @param {number} turn */
function move(forward, strafe, turn) {
  yaw += turn;
  var nx = x - Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
  var nz = z - Math.cos(yaw) * forward - Math.sin(yaw) * strafe;
  if (!blocked(nx, z)) x = nx;
  if (!blocked(x, nz)) z = nz;
  render();
}
function fire() {
  var distance = 0,
    hitX = x,
    hitZ = z;
  shots++;
  while (distance < 10) {
    hitX = x - Math.sin(yaw) * distance;
    hitZ = z - Math.cos(yaw) * distance;
    if (blocked(hitX, hitZ)) break;
    distance += 0.05;
  }
  lastHit = distance;
  // Keep the marker just in front of the hit surface.
  scene.setTranslation(
    cursor,
    hitX + Math.sin(yaw) * 0.1,
    0.8,
    hitZ + Math.cos(yaw) * 0.1,
  );
}
events.onStart(start);
events.onReceive("move", move, ["float", "float", "float"], {
  coalesce: "movement",
});
events.onReceive("fire", fire, []);
events.onReceive("reset", start, [], { interrupt: true });
