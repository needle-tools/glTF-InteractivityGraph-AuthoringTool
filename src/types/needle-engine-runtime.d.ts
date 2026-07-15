declare module "needle-engine-runtime" {
    export class OrbitControls {
        fitCamera(options?: NeedleCameraFitOptions): unknown;
    }

    export class WebXRButtonFactory {
        static getOrCreate(): WebXRButtonFactory;
        createARButton(init?: XRSessionInit): HTMLButtonElement;
    }

    export interface NeedleCameraFitOptions {
        objects?: unknown;
        fitOffset?: number;
        fitDirection?: { x: number; y: number; z: number };
        relativeCameraOffset?: { x?: number; y?: number; z?: number };
        cameraNearFar?: "keep" | "auto";
        immediate?: boolean;
    }

    export function getComponent(object: unknown, componentType: typeof OrbitControls): OrbitControls | null;
}
