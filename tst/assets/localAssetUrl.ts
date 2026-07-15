import fs from "fs";
import path from "path";

export function fileDataUrl(filePath: string, mimeType = mimeTypeForPath(filePath)): string {
    return `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

export function localResourceDataUrl(url: string, root: string): string | undefined {
    if (url.startsWith("data:")) return undefined;
    const cleanUrl = decodeURIComponent(url.split(/[?#]/, 1)[0]);
    const resourcePath = path.isAbsolute(cleanUrl) ? cleanUrl : path.resolve(root, cleanUrl);
    if (!fs.existsSync(resourcePath) || !fs.statSync(resourcePath).isFile()) return undefined;
    return fileDataUrl(resourcePath);
}

function mimeTypeForPath(filePath: string): string {
    switch (path.extname(filePath).toLowerCase()) {
        case ".gltf": return "model/gltf+json";
        case ".glb": return "model/gltf-binary";
        case ".png": return "image/png";
        case ".jpg":
        case ".jpeg": return "image/jpeg";
        default: return "application/octet-stream";
    }
}
