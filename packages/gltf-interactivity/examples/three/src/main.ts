import { registerGLTFInteractivity } from "@needle-tools/gltf-interactivity";
import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
  const status = document.querySelector<HTMLElement>("#status")!;
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(640, 360);
  renderer.setClearColor(0xffffff);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 640 / 360, 0.1, 100);
  camera.position.set(0, 0.5, 4);

  const loader = new GLTFLoader();
  registerGLTFInteractivity(loader, {
    onReady(runtime) {
      runtime.setCamera(camera);
      runtime.attachPointerEvents(canvas);
    },
  });

  const gltf = await loader.loadAsync("/interactive.gltf");
  scene.add(gltf.scene);
  const x = gltf.scene.getObjectByName("InteractiveTriangle")?.position.x;
  status.textContent = x === 1 ? "ready:1" : `unexpected:${String(x)}`;
  document.body.dataset.interactivityReady = String(x === 1);

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

void main();
