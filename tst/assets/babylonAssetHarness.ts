import path from "path";
import { NullEngine, Scene as BabylonScene, SceneLoader } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { GLTFFileLoader, GLTFLoaderAnimationStartMode } from "@babylonjs/loaders";
import { buildBabylonDecoratorWorld, buildBabylonLoadedModel } from "../../src/components/engineViews/babylonLoadedModel";
import { registerKHRInteractivityExtension } from "../../src/loaderExtensions/KHR_interactivity";
import { fileDataUrl, localResourceDataUrl } from "./localAssetUrl";

export { NullEngine, BabylonScene };

let loaderConfigured = false;

export async function loadBabylonWorldFromGlb(glbPath: string, scene: BabylonScene): Promise<any> {
    return loadBabylonWorldFromGltf(glbPath, scene);
}

export async function loadBabylonWorldFromGltf(assetPath: string, scene: BabylonScene): Promise<any> {
    configureBabylonLoader();

    const absolutePath = path.resolve(assetPath);
    const extension = path.extname(absolutePath).toLowerCase();
    const observer = SceneLoader.OnPluginActivatedObservable.add((loader) => {
        if (loader.name === "gltf") {
            (loader as GLTFFileLoader).preprocessUrlAsync = async (url) => localResourceDataUrl(url, path.dirname(absolutePath)) ?? url;
        }
    });

    try {
        const container = await SceneLoader.LoadAssetContainerAsync(
            "",
            fileDataUrl(absolutePath),
            scene,
            undefined,
            extension,
            path.basename(absolutePath),
        );
        container.addAllToScene();
        return buildBabylonDecoratorWorld(buildBabylonLoadedModel(container));
    } finally {
        SceneLoader.OnPluginActivatedObservable.remove(observer);
    }
}

function configureBabylonLoader(): void {
    if (!loaderConfigured) {
        registerKHRInteractivityExtension();
        SceneLoader.OnPluginActivatedObservable.add((loader) => {
            if (loader.name === "gltf") {
                (loader as GLTFFileLoader).animationStartMode = GLTFLoaderAnimationStartMode.NONE;
            }
        });
        loaderConfigured = true;
    }
}
