import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "../fixture",
  resolve: {
    dedupe: ["@needle-tools/engine", "three"],
  },
});
