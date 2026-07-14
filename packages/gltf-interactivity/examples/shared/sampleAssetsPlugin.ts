import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import type { SampleAsset, SampleManifest, SampleMetadata } from "./sampleTypes";

const routePrefix = "/__sample_assets__/";

export function sampleAssetsPlugin(): Plugin {
  const assetsRoot = findAssetsRoot();
  const manifest = createManifest(assetsRoot);

  const installMiddleware = (middlewares: {
    use(handler: (request: any, response: any, next: () => void) => void): void;
  }): void => {
    middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === `${routePrefix}manifest.json`) {
        response.statusCode = manifest.available ? 200 : 503;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(manifest));
        return;
      }
      if (!pathname.startsWith(routePrefix) || !manifest.available || !assetsRoot) {
        next();
        return;
      }

      const relativePath = decodeURIComponent(pathname.slice(routePrefix.length));
      const filePath = path.resolve(assetsRoot, relativePath);
      if (!filePath.startsWith(`${assetsRoot}${path.sep}`) || !fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", contentType(filePath));
      response.setHeader("Content-Length", fs.statSync(filePath).size);
      fs.createReadStream(filePath).pipe(response);
    });
  };

  return {
    name: "gltf-interactivity-sample-assets",
    configureServer(server) {
      installMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installMiddleware(server.middlewares);
    },
  };
}

function findAssetsRoot(): string | undefined {
  const configured = process.env.KHR_INTERACTIVITY_SAMPLE_ASSETS;
  if (configured) return path.resolve(configured);

  let current = path.resolve(process.cwd());
  while (true) {
    const candidate = path.join(current, "glTF-Test-Assets-Interactivity");
    if (fs.existsSync(path.join(candidate, "Tests", "Interactivity"))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function createManifest(assetsRoot: string | undefined): SampleManifest {
  if (!assetsRoot || !fs.existsSync(path.join(assetsRoot, "Tests", "Interactivity"))) {
    return {
      available: false,
      error: "glTF-Test-Assets-Interactivity was not found. Set KHR_INTERACTIVITY_SAMPLE_ASSETS before starting Vite.",
      assets: [],
      totals: { models: 0, testAssets: 0, runnableSubtests: 0 },
    };
  }

  const assets = [
    ...createTestAssets(assetsRoot),
    ...createModelAssets(assetsRoot),
  ];
  return {
    available: true,
    root: assetsRoot,
    assets,
    totals: {
      models: assets.filter(asset => asset.kind === "model").length,
      testAssets: assets.filter(asset => asset.kind === "test").length,
      runnableSubtests: assets.reduce((sum, asset) => sum + (asset.runnable ? asset.subtestCount : 0), 0),
    },
  };
}

function createTestAssets(assetsRoot: string): SampleAsset[] {
  const root = path.join(assetsRoot, "Tests", "Interactivity");
  const indexedEntries = ["test-index.json", "mathtests-index.json"]
    .flatMap(fileName => readJson<any[]>(path.join(root, fileName)));
  const indexedByMetadata = new Map(indexedEntries.map(entry => [
    path.resolve(root, entry.name, "test-Json", entry.variants["test-Json"]),
    entry,
  ]));
  const metadataPaths = findFiles(root, filePath => (
    filePath.includes(`${path.sep}test-Json${path.sep}`) && filePath.endsWith(".json")
  ));
  const assets = metadataPaths.map(metadataPath => {
    const metadata = readJson<SampleMetadata>(metadataPath);
    const assetDirectory = path.dirname(path.dirname(metadataPath));
    const entry = indexedByMetadata.get(path.resolve(metadataPath));
    const name = entry?.name ?? normalizePath(path.relative(root, assetDirectory));
    const glbPath = path.join(assetDirectory, "glTF-Binary", entry?.variants["glTF-Binary"] ?? metadata.glbFileName);
    const interGlb = name.startsWith("InterGlb/");
    return {
      id: `test:${name}`,
      kind: "test" as const,
      label: entry?.label ?? metadata.name ?? name,
      name,
      tags: entry?.tags ?? [],
      url: assetUrl(assetsRoot, glbPath),
      metadataUrl: assetUrl(assetsRoot, metadataPath),
      subtestCount: countSubtests(metadata),
      runnable: !interGlb,
      description: interGlb ? "Requires the paired cross-file runner" : undefined,
    };
  });

  const overviewMetadataPath = path.join(root, "Overview.json");
  if (fs.existsSync(overviewMetadataPath)) {
    const metadata = readJson<SampleMetadata>(overviewMetadataPath);
    assets.push({
      id: "test:Overview",
      kind: "test",
      label: metadata.name || "Overview",
      name: "Overview",
      tags: [],
      url: assetUrl(assetsRoot, path.join(root, metadata.glbFileName)),
      metadataUrl: assetUrl(assetsRoot, overviewMetadataPath),
      subtestCount: countSubtests(metadata),
      runnable: true,
    });
  }

  return assets.sort((a, b) => a.name.localeCompare(b.name));
}

function createModelAssets(assetsRoot: string): SampleAsset[] {
  const root = path.join(assetsRoot, "Models");
  const indexPath = path.join(root, "model-index.json");
  if (!fs.existsSync(indexPath)) return [];

  return readJson<any[]>(indexPath).map(entry => ({
    id: `model:${entry.name}`,
    kind: "model" as const,
    label: entry.label,
    name: entry.name,
    description: entry.description,
    tags: entry.tags ?? [],
    url: assetUrl(assetsRoot, path.join(root, entry.name, "glTF-Binary", entry.variants["glTF-Binary"])),
    subtestCount: 0,
    runnable: false,
  })).sort((a, b) => a.label.localeCompare(b.label));
}

function findFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile() && predicate(filePath)) files.push(filePath);
    }
  };
  walk(root);
  return files;
}

function assetUrl(assetsRoot: string, filePath: string): string {
  const relativePath = normalizePath(path.relative(assetsRoot, filePath));
  return `${routePrefix}${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function countSubtests(metadata: SampleMetadata): number {
  return metadata.tests.reduce((sum, test) => sum + test.subTests.length, 0);
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".json": return "application/json; charset=utf-8";
    case ".gltf": return "model/gltf+json";
    case ".glb": return "model/gltf-binary";
    case ".bin": return "application/octet-stream";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".ktx2": return "image/ktx2";
    default: return "application/octet-stream";
  }
}
