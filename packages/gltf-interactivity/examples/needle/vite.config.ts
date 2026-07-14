import { defineConfig } from "vite";
import { sampleAssetsPlugin } from "../shared/sampleAssetsPlugin";

export default defineConfig({
  publicDir: "../fixture",
  plugins: [sampleAssetsPlugin()],
  resolve: {
    dedupe: ["@needle-tools/engine", "three"],
  },
});
