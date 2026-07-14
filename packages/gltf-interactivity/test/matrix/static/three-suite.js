import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  getInteractivityRuntime,
  registerGLTFInteractivity,
} from "@needle-tools/gltf-interactivity";

const config = window.__GLTF_INTERACTIVITY_MATRIX_CONFIG__;

try {
  window.__GLTF_INTERACTIVITY_MATRIX_RESULT__ = await runSuite();
}
catch (error) {
  window.__GLTF_INTERACTIVITY_MATRIX_RESULT__ = {
    status: "failed",
    id: config.id,
    error: error?.stack || error?.message || String(error),
  };
}

async function runSuite() {
  const canvas = document.querySelector("#fixture");
  const loader = new GLTFLoader();
  let readyCount = 0;
  const unregister = registerGLTFInteractivity(loader, {
    onReady(runtime) {
      readyCount += 1;
      runtime.setCamera(new THREE.PerspectiveCamera());
      runtime.attachPointerEvents(canvas);
    },
  });

  let runtime;
  let renderer;
  try {
    const gltf = await loader.loadAsync(config.fixtureUrl);
    runtime = getInteractivityRuntime(gltf);
    assert(runtime, "the loader attached an interactivity runtime");
    assert(readyCount === 1, "the runtime was created exactly once");
    assert(getInteractivityRuntime(runtime.model) === runtime, "the model shares the loader runtime");
    assert(runtime.model.nodes[0]?.position.x === 1, "event/onStart ran before loadAsync resolved");
    assert(gltf.scene.getObjectByName("InteractiveTriangle")?.position.x === 1, "pointer/set updated the loaded scene");
    assert(runtime.model.scene instanceof THREE.Object3D, "the runtime uses the mapped Three.js instance");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.add(gltf.scene);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(128, 128, false);
    renderer.render(scene, camera);
    const coloredPixels = countColoredPixels(renderer.getContext(), 128, 128);
    assert(coloredPixels > 0, "the loaded fixture rendered non-background pixels");

    return {
      status: "passed",
      id: config.id,
      version: config.version,
      rendererMode: config.rendererMode,
      threeRevision: THREE.REVISION,
      readyCount,
      nodeX: runtime.model.nodes[0].position.x,
      coloredPixels,
      assertionCount: 7,
    };
  }
  finally {
    runtime?.dispose();
    renderer?.dispose();
    unregister();
  }
}

function countColoredPixels(gl, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] > pixels[index + 1] * 1.5 && pixels[index] > pixels[index + 2] * 1.5) count += 1;
  }
  return count;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
