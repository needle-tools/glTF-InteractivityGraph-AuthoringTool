import "@needle-tools/engine";
import { registerNeedleInteractivity } from "three-gltf-interactivity/needle";

const asset = new URLSearchParams(location.search).get("asset") ?? "../await-results/example.glb";
let runtime;
registerNeedleInteractivity({
  autoStart: false,
  onReady(value) {
    runtime = value;
    runtime.decorator.loadBehaveGraph(runtime.graph, false);
  },
});
const element = document.createElement("needle-engine");
element.setAttribute("background-color", "#08141d");
element.setAttribute("camera-controls", "false");
document.body.append(element);
const loaded = new Promise((resolve, reject) => {
  element.addEventListener("loadfinished", resolve, { once: true });
  element.addEventListener("error", reject, { once: true });
});
element.setAttribute("src", new URL(asset, location.href).href);
await loaded;
const context = element.context, camera = context.mainCamera;
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, -2);
camera.updateProjectionMatrix();
runtime.setCamera(camera);
context.pre_render_callbacks.push(() => {
  runtime.engine.executeEventQueueTick();
  const read = name => runtime.engine.variables.find(v => v.name === "JS global " + name)?.value[0];
  document.querySelector("#status").textContent = "Needle · R restarts · " +
    (read("completed") ? "Complete" : "Working") + " · result " +
    Number(read("result")).toFixed(2) + " · frames " + read("frames");
});
addEventListener("keydown", event => {
  if (event.code === "KeyR" && !event.repeat) runtime.sendEvent("restart");
});
window.example = { runtime, model: runtime.model, renderer: context.renderer, camera,
  send: (id, values) => runtime.sendEvent(id, values) };
