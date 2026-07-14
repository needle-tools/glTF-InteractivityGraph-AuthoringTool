import "@needle-tools/engine";
import { registerNeedleInteractivity } from "@needle-tools/gltf-interactivity/needle";

const status = document.querySelector<HTMLElement>("#status")!;
registerNeedleInteractivity({
  pointerEvents: false,
  onReady(runtime) {
    const x = runtime.model.nodes[0]?.position.x;
    status.textContent = `runtime:${String(x)}`;
    requestAnimationFrame(() => {
      const updatedX = runtime.model.nodes[0]?.position.x;
      status.textContent = updatedX === 1 ? "ready:1" : `unexpected:${String(updatedX)}`;
      document.body.dataset.interactivityReady = String(updatedX === 1);
    });
  },
});

const engine = document.createElement("needle-engine");
engine.setAttribute("camera-controls", "true");
engine.setAttribute("background-color", "#ffffff");
engine.setAttribute("src", "/interactive.gltf");
engine.style.width = "640px";
engine.style.height = "360px";
document.body.append(engine);
