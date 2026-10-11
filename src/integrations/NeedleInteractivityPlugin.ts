import {
    addCustomExtensionPlugin,
    onClear,
    onUpdate,
    removeCustomImportExtensionType,
    type Context,
    type INeedleGLTFExtensionPlugin,
} from "@needle-tools/engine";
import type { Camera } from "three";
import { attachNeedlePointerEvents, attachNeedleXRPointerEvents, type NeedleContext } from "./NeedlePointerEvents";
import {
    registerGLTFInteractivity,
    type GLTFInteractivityRegistrationOptions,
} from "./GLTFInteractivityPlugin";
import type { InteractivityRuntime } from "./InteractivityRuntime";

export interface NeedleInteractivityPluginOptions extends Omit<
    GLTFInteractivityRegistrationOptions,
    "manualAnimationUpdates" | "registerAnimationPointer"
> {
    pointerEvents?: boolean;
}

export function createNeedleInteractivityPlugin(
    options: NeedleInteractivityPluginOptions = {},
): INeedleGLTFExtensionPlugin {
    return {
        name: "KHR_interactivity",
        onImport(loader, _url, context) {
            const userOnReady = options.onReady;
            registerGLTFInteractivity(loader, {
                ...options,
                // The graph's delays/ticks use elapsed time. Needle caps its frame delta,
                // which otherwise makes animations drift after loading or slow frames.
                manualAnimationUpdates: false,
                registerAnimationPointer: false,
                async onReady(runtime, gltf) {
                    bindNeedleRuntime(runtime, context, options.pointerEvents !== false);
                    await userOnReady?.(runtime, gltf);
                },
            });
        },
    };
}

export function registerNeedleInteractivity(
    options: NeedleInteractivityPluginOptions = {},
): () => void {
    const plugin = createNeedleInteractivityPlugin(options);
    addCustomExtensionPlugin(plugin);
    return () => removeCustomImportExtensionType(plugin);
}

function bindNeedleRuntime(runtime: InteractivityRuntime, context: Context, pointerEvents: boolean): void {
    const needleContext = context as unknown as NeedleContext;
    const xrInput = pointerEvents ? attachNeedleXRPointerEvents(needleContext, runtime.model, runtime.decorator) : undefined;
    runtime.setCamera((needleContext.xrCamera ?? context.mainCamera) as Camera);
    if (pointerEvents) {
        runtime.addCleanup(attachNeedlePointerEvents(
            context as unknown as NeedleContext,
            runtime.model,
            runtime.decorator,
        ));
    }

    const removeUpdate = onUpdate((currentContext) => {
        if (currentContext !== context) return;
        runtime.setCamera((needleContext.xrCamera ?? context.mainCamera) as Camera);
        runtime.update(context.time.deltaTime);
        xrInput?.update();
    });
    const removeClear = onClear((currentContext) => {
        if (currentContext !== context) return;
        runtime.dispose();
    });
    runtime.addCleanup(removeUpdate);
    runtime.addCleanup(removeClear);
    if (xrInput) runtime.addCleanup(() => xrInput.dispose());
}
