import { jest } from "@jest/globals";
import { Object3D } from "three";
import { configureNeedleXR, NEEDLE_AR_OPTIONS } from "../src/integrations/NeedleXR";

describe("Needle XR configuration", () => {
    it("enables reticle placement and post-placement adjustment once per context", () => {
        const addWebXR = jest.fn();
        const context = {
            scene: new Object3D(),
            menu: { showFullscreenOption: jest.fn() },
        };

        configureNeedleXR(context, addWebXR);
        configureNeedleXR(context, addWebXR);

        expect(addWebXR).toHaveBeenCalledTimes(1);
        expect(addWebXR).toHaveBeenCalledWith(context.scene, NEEDLE_AR_OPTIONS);
        expect(NEEDLE_AR_OPTIONS).toMatchObject({
            createARButton: true,
            createVRButton: false,
            usePlacementReticle: true,
            usePlacementAdjustment: true,
            autoPlace: false,
        });
        expect(context.menu.showFullscreenOption).toHaveBeenCalledWith(true);
    });
});
