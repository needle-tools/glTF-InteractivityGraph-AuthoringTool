import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { getDefaultCacheRoot } from "@needle-tools/three-test-matrix";
import { rawFsServePlugin } from "@needle-tools/three-test-matrix/vite";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testRoot, "../..");
const sharedCacheRoot = getDefaultCacheRoot({ cwd: packageRoot });

export default defineConfig({
  appType: "mpa",
  plugins: [rawFsServePlugin({
    cacheRoots: [packageRoot, sharedCacheRoot],
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  })],
  server: {
    fs: {
      allow: [packageRoot, sharedCacheRoot],
    },
  },
});
