import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  registerGLTFInteractivity,
  getInteractivityRuntime,
} from "three-gltf-interactivity";
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#08141d");
scene.add(new THREE.HemisphereLight(0xffffff, 0x203040, 2));
const asset =
    new URLSearchParams(location.search).get("asset") ?? "../surface-cursor/example.glb",
  loader = new GLTFLoader();
registerGLTFInteractivity(loader, { autoStart: false });
const model = await loader.loadAsync(asset),
  runtime = getInteractivityRuntime(model);
scene.add(model.scene);
const camera =
  model.cameras[0] ?? new THREE.PerspectiveCamera(45, 1, 0.01, 100);
if (!model.cameras.length) camera.position.set(0, 0, 5);
runtime.setCamera(camera);
runtime.attachPointerEvents(renderer.domElement);
runtime.decorator.loadBehaveGraph(runtime.graph, false);
const eventIds = new Set((runtime.graph.events ?? []).map((event) => event.id));
const isGrid = eventIds.has("move") && eventIds.has("fire");
document.body.classList.toggle("grid", isGrid);
document.querySelector("#instructions").textContent = isGrid
  ? "W/S move · A/D turn · Q/E strafe · Space fire · R reset"
  : "Click or hover over the quad.";
const keys = new Set();
addEventListener("keydown", (event) => {
  if (
    ["Space", "KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE", "KeyR"].includes(
      event.code,
    )
  )
    event.preventDefault();
  keys.add(event.code);
  if (event.code === "Space" && eventIds.has("fire") && !event.repeat)
    runtime.sendEvent("fire");
  if (event.code === "KeyR" && eventIds.has("reset") && !event.repeat)
    runtime.sendEvent("reset");
});
addEventListener("keyup", (event) => keys.delete(event.code));
addEventListener("blur", () => keys.clear());
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
let previous = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS")),
    strafe = Number(keys.has("KeyE")) - Number(keys.has("KeyQ")),
    turn = Number(keys.has("KeyA")) - Number(keys.has("KeyD"));
  if (isGrid && (forward || strafe || turn))
    runtime.sendEvent("move", {
      forward: forward * dt * 2,
      strafe: strafe * dt * 2,
      turn: turn * dt * 2,
    });
  runtime.engine.executeEventQueueTick();
  runtime.update(dt);
  renderer.render(scene, camera);
});
window.example = {
  runtime,
  scene,
  model,
  renderer,
  camera,
  send: (id, values) => runtime.sendEvent(id, values),
};
document.querySelector("#status").textContent = asset;
