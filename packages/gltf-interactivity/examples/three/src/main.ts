import {
  getInteractivityRuntime,
  registerGLTFInteractivity,
  type InteractivityRuntime,
} from "@needle-tools/gltf-interactivity";
import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createSampleBrowser,
  type BrowserRuntime,
} from "../../shared/sampleBrowser";
import type { SampleAsset } from "../../shared/sampleTypes";

const scene = new Scene();
scene.background = new Color(0xffffff);
const camera = new PerspectiveCamera(45, 1, 0.01, 10_000);
const loader = new GLTFLoader();
let renderer: WebGLRenderer;
let controls: OrbitControls;
let currentGltf: GLTF | undefined;
let currentRuntime: InteractivityRuntime | undefined;

registerGLTFInteractivity(loader, {
  onReady(runtime) {
    runtime.setCamera(camera);
    runtime.attachPointerEvents(renderer.domElement);
  },
});

const browserReady = createSampleBrowser({
  engineName: "Three.js",
  defaultAssetId: "model:WhackAMole",
  loadAsset,
});

const host = document.querySelector<HTMLElement>("#viewport-host")!;
const canvas = document.createElement("canvas");
host.append(canvas);
renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = "srgb";

camera.position.set(3, 2.2, 5);
controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const hemisphere = new HemisphereLight(0xffffff, 0x737980, 2);
const keyLight = new DirectionalLight(0xffffff, 2.5);
keyLight.position.set(4, 7, 5);
scene.add(hemisphere, keyLight);

new ResizeObserver(resizeRenderer).observe(host);
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
resizeRenderer();
await browserReady;

async function loadAsset(asset: SampleAsset): Promise<{ runtime?: BrowserRuntime }> {
  disposeCurrentAsset();
  const gltf = await loader.loadAsync(asset.url);
  const runtime = getInteractivityRuntime(gltf);
  if (!runtime) throw new Error("GLTFLoader did not attach a KHR_interactivity runtime");
  currentGltf = gltf;
  currentRuntime = runtime;
  scene.add(gltf.scene);
  frameObject(gltf.scene);
  return { runtime: runtime as BrowserRuntime };
}

function frameObject(root: Object3D): void {
  root.updateWorldMatrix(true, true);
  const sphere = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
  const halfFov = MathUtils.degToRad(camera.fov * 0.5);
  const distance = radius / Math.max(0.1, Math.sin(halfFov));
  const direction = new Vector3(1, 0.72, 1.45).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(direction, distance * 1.25);
  camera.near = Math.max(0.001, distance / 500);
  camera.far = Math.max(100, distance * 100);
  camera.updateProjectionMatrix();
  controls.update();
}

function resizeRenderer(): void {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function disposeCurrentAsset(): void {
  currentRuntime?.dispose();
  currentRuntime = undefined;
  if (!currentGltf) return;
  scene.remove(currentGltf.scene);
  currentGltf.scene.traverse(object => {
    if (!(object as Mesh).isMesh) return;
    const mesh = object as Mesh;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  });
  currentGltf = undefined;
}
