import type { Object3D } from "three";

export interface NeedleXRContext {
    scene: Object3D;
    menu: {
        showFullscreenOption(visible: boolean): void;
    };
}

export const NEEDLE_AR_OPTIONS = Object.freeze({
    createARButton: true,
    createVRButton: false,
    createQRCode: false,
    createSendToQuestButton: false,
    usePlacementReticle: true,
    usePlacementAdjustment: true,
    autoPlace: true,
});

const configuredContexts = new WeakSet<object>();

export function configureNeedleXR(
    context: NeedleXRContext,
    addWebXR: (scene: Object3D, options: typeof NEEDLE_AR_OPTIONS) => void,
): void {
    if (configuredContexts.has(context)) return;
    configuredContexts.add(context);

    addWebXR(context.scene, NEEDLE_AR_OPTIONS);
    context.menu.showFullscreenOption(true);
}
