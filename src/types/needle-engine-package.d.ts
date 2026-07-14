import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface Context {
    mainCamera: unknown;
    renderer: { domElement: HTMLElement };
    physics: unknown;
    time: { deltaTime: number };
}

export interface INeedleGLTFExtensionPlugin {
    name: string;
    onImport?: (loader: GLTFLoader, url: string, context: Context) => void;
    onLoaded?: (url: string, gltf: GLTF, context: Context) => void;
}

export function addCustomExtensionPlugin(plugin: INeedleGLTFExtensionPlugin): void;
export function removeCustomImportExtensionType(plugin: INeedleGLTFExtensionPlugin): void;
export function onClear(callback: (context: Context) => void): () => void;
export function onUpdate(callback: (context: Context) => void): () => void;
