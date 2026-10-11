import { babel } from "@rollup/plugin-babel";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import presetTypeScript from "@babel/preset-typescript";
import path from "node:path";

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
        {
            name: "external-khronos-engine",
            resolveId(source, importer) {
                if (!importer || !source.startsWith(".")) return null;
                const resolved = path.resolve(path.dirname(importer), source);
                const engineRoot = path.resolve("../../src/BasicBehaveEngine");
                if (resolved.startsWith(engineRoot + path.sep)) {
                    return { id: "@khronosgroup/gltf-interactivity-engine", external: true };
                }
                return null;
            },
        },
        nodeResolve({ extensions: [".mjs", ".js", ".json", ".ts"] }),
        babel({
            babelHelpers: "bundled",
            extensions: [".ts"],
            presets: [[presetTypeScript, { allowDeclareFields: true }]],
        }),
    ],
};
