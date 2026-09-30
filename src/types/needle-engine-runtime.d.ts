declare module "needle-engine-runtime" {
    export class WebXR {
        createARButton: boolean;
        createVRButton: boolean;
        createQRCode: boolean;
        createSendToQuestButton: boolean;
        usePlacementReticle: boolean;
        usePlacementAdjustment: boolean;
        autoPlace: boolean;
    }

    export class GameObject {
        static addComponent<T>(
            object: unknown,
            componentType: new () => T,
            init?: Partial<T>,
        ): T;
    }

    export class OrbitControls {
        fitCamera(options?: NeedleCameraFitOptions): unknown;
        // the wrapped Three.js controls
        readonly controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls | null;
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
