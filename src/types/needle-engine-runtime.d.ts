declare module "needle-engine-runtime" {
    export class WebXRButtonFactory {
        static getOrCreate(): WebXRButtonFactory;
        createARButton(init?: XRSessionInit): HTMLButtonElement;
    }

    export interface NeedleCameraFitOptions {
        context: unknown;
        objects: unknown;
        fitOffset?: number;
        relativeCameraOffset?: { x?: number; y?: number; z?: number };
        cameraNearFar?: "keep" | "auto";
    }

    export function fitCamera(options: NeedleCameraFitOptions): unknown;
}
