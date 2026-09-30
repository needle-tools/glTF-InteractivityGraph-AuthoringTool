import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { ArcRotateCameraMouseWheelInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraMouseWheelInput";
import type { PerspectiveCamera } from "three";
import type { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const MODEL_VIEW_Z_DIRECTION = 1;

// fraction of the current camera distance moved per wheel/pinch step
const ZOOM_STEP_PERCENTAGE = 0.01;
// near plane as a fraction of the camera distance: close enough for zoomed-in details,
// far enough to keep depth precision
const NEAR_PLANE_RATIO = 0.01;

// model size used by the per-frame update, refreshed whenever the camera is reframed
const modelSizeByCamera = new WeakMap<ArcRotateCamera, number>();

/**
 * Scale-independent navigation for models of any size. Babylon's default camera derives fixed
 * wheel steps, pan speed, radius limit and near plane from the whole scene, which makes large
 * scenes (e.g. the Overview test asset) coarse to zoom and impossible to get close to.
 * Call after the camera is (re)created or framed; `modelSize` is the largest bounding box extent.
 */
export const configureModelNavigation = (camera: ArcRotateCamera, modelSize: number): void => {
    const size = Number.isFinite(modelSize) && modelSize > 0 ? modelSize : 1;
    const isFirstConfiguration = !modelSizeByCamera.has(camera);
    modelSizeByCamera.set(camera, size);

    // zoom by a percentage of the current distance, so steps shrink as you get closer, and
    // towards the cursor, so the pivot follows into whatever part of the scene is under it
    camera.wheelDeltaPercentage = ZOOM_STEP_PERCENTAGE;
    camera.pinchDeltaPercentage = ZOOM_STEP_PERCENTAGE;
    const wheelInput = camera.inputs.attached.mousewheel as ArcRotateCameraMouseWheelInput | undefined;
    if (wheelInput) {
        wheelInput.zoomToMouseLocation = true;
    }
    camera.lowerRadiusLimit = size * 1e-4;
    camera.upperRadiusLimit = size * 10;
    camera.maxZ = size * 100;

    if (isFirstConfiguration) {
        const updateForDistance = () => {
            const currentSize = modelSizeByCamera.get(camera) ?? size;
            camera.minZ = Math.max(camera.radius * NEAR_PLANE_RATIO, currentSize * 1e-6);
            // pixels per world unit at the target distance, so a pan drags the model with the cursor;
            // pan inertia sums each offset up by 1 / (1 - panningInertia), so compensate for it
            // pointer offsets are CSS pixels, while the render height includes the device pixel ratio
            const engine = camera.getEngine();
            const viewHeight = engine.getRenderingCanvasClientRect()?.height || engine.getRenderHeight() || 1;
            const inertiaGain = 1 / Math.max(1 - camera.panningInertia, 0.01);
            camera.panningSensibility = inertiaGain * viewHeight / (2 * camera.radius * Math.tan(camera.fov / 2));
        };
        camera.onViewMatrixChangedObservable.add(updateForDistance);
        updateForDistance();
    }
};

// model size used by the Three.js near-plane update, refreshed whenever the view is reframed
const threeModelSizeByControls = new WeakMap<ThreeOrbitControls, number>();

/**
 * Three.js / Needle Engine counterpart of configureModelNavigation. OrbitControls already zooms
 * by a factor and pans in screen space, so this adds zoom towards the cursor, distance limits from
 * the model size and a near plane that follows the distance (a fixed one clips close-ups in large
 * scenes). Call after framing; `modelSize` is the largest bounding box extent.
 */
export const configureThreeModelNavigation = (camera: PerspectiveCamera, controls: ThreeOrbitControls, modelSize: number): void => {
    const size = Number.isFinite(modelSize) && modelSize > 0 ? modelSize : 1;
    const isFirstConfiguration = !threeModelSizeByControls.has(controls);
    threeModelSizeByControls.set(controls, size);

    controls.zoomToCursor = true;
    controls.minDistance = size * 1e-4;
    controls.maxDistance = size * 10;
    camera.far = size * 100;

    const updateForDistance = () => {
        const currentSize = threeModelSizeByControls.get(controls) ?? size;
        const distance = camera.position.distanceTo(controls.target);
        camera.near = Math.max(distance * NEAR_PLANE_RATIO, currentSize * 1e-6);
        camera.updateProjectionMatrix();
    };
    if (isFirstConfiguration) {
        controls.addEventListener("change", updateForDistance);
    }
    updateForDistance();
};
