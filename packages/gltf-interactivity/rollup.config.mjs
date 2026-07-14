import { babel } from "@rollup/plugin-babel";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import presetTypeScript from "@babel/preset-typescript";

const external = (id) => id === "three"
    || id.startsWith("three/")
    || id === "gl-matrix"
    || id === "@needle-tools/engine"
    || id === "@needle-tools/three-animation-pointer";

export default {
    input: {
        index: "src/index.ts",
        needle: "src/needle.ts",
    },
    output: {
        dir: "dist",
        format: "es",
        sourcemap: true,
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
    },
    external,
    plugins: [
        nodeResolve({ extensions: [".mjs", ".js", ".json", ".ts"] }),
        babel({
            babelHelpers: "bundled",
            extensions: [".ts"],
            presets: [[presetTypeScript, { allowDeclareFields: true }]],
        }),
    ],
};
