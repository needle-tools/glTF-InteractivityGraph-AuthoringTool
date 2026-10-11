import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const packageRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const repoRoot = path.resolve(packageRoot, "../..");
const cache = path.join(packageRoot, ".cache");
await fs.mkdir(cache, { recursive: true });
const consumer = await fs.mkdtemp(path.join(cache, "packed-consumer-"));
function run(cmd, args, cwd) {
    return execFileSync(cmd, args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
}
const artifacts = [];
for (const root of [
    path.join(repoRoot, "src/BasicBehaveEngine"),
    packageRoot,
]) {
    const result = JSON.parse(
        run("npm", ["pack", "--json", "--pack-destination", consumer], root),
    )[0];
    const tarball = path.join(consumer, result.filename);
    artifacts.push({
        name: result.name,
        version: result.version,
        tarball,
        sha256: createHash("sha256")
            .update(await fs.readFile(tarball))
            .digest("hex"),
    });
}
await fs.writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify(
        {
            name: "gltf-interactivity-packed-consumer",
            private: true,
            type: "module",
            dependencies: Object.fromEntries(
                artifacts.map((a) => [a.name, a.tarball]),
            ),
            devDependencies: {
                three: "latest",
                "@types/three": "latest",
                typescript: "^5.9.3",
                vite: "^7.3.5",
            },
        },
        null,
        2,
    ),
);
console.log(
    run(
        "npm",
        [
            "install",
            "--prefix",
            consumer,
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
        ],
        consumer,
    ),
);
await fs.writeFile(
    path.join(consumer, "index.html"),
    '<canvas></canvas><script type="module" src="/main.ts"></script>',
);
await fs.writeFile(
    path.join(consumer, "main.ts"),
    'import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";\nimport { registerGLTFInteractivity } from "three-gltf-interactivity";\nimport { BasicBehaveEngine } from "@khronosgroup/gltf-interactivity-engine";\nregisterGLTFInteractivity(new GLTFLoader()); console.log(BasicBehaveEngine);\n',
);
await fs.writeFile(
    path.join(consumer, "tsconfig.json"),
    JSON.stringify({
        compilerOptions: {
            target: "ES2020",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            skipLibCheck: false,
            types: ["three"],
            noEmit: true,
        },
        include: ["main.ts"],
    }),
);
console.log(
    run(
        process.execPath,
        [
            path.join(consumer, "node_modules/typescript/bin/tsc"),
            "-p",
            consumer,
        ],
        consumer,
    ),
);
console.log(
    run(
        process.execPath,
        [
            path.join(consumer, "node_modules/vite/bin/vite.js"),
            "build",
            consumer,
        ],
        consumer,
    ),
);
const metadata = {
    consumer,
    revision: run("git", ["rev-parse", "HEAD"], repoRoot).trim(),
    workingDiffSha256: createHash("sha256")
        .update(run("git", ["diff", "HEAD"], repoRoot))
        .digest("hex"),
    artifacts,
    dependencyTree: JSON.parse(
        run("npm", ["ls", "--prefix", consumer, "--json"], consumer),
    ),
};
// A separate production consumer keeps each Needle release's declared Three distribution.
metadata.threeConsumers = [{ version: metadata.dependencyTree.dependencies.three.version, directory: consumer }];
const peer = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")).peerDependencies.three;
const minimum = peer.match(/>=([0-9.]+)/)[1];
const minimumTypes = minimum.split(".").slice(0, 2).join(".") + ".0";
const minimumConsumer = path.join(consumer, "three-minimum");
await fs.mkdir(minimumConsumer);
await fs.writeFile(path.join(minimumConsumer, "package.json"), JSON.stringify({
    name: "gltf-interactivity-minimum-three-consumer", private: true, type: "module",
    dependencies: { ...Object.fromEntries(artifacts.map(a => [a.name, a.tarball])), three: minimum },
    devDependencies: { "@types/three": minimumTypes, typescript: "^5.9.3", vite: "^7.3.5" },
}, null, 2));
console.log(run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], minimumConsumer));
for (const file of ["index.html", "main.ts", "tsconfig.json"]) await fs.copyFile(path.join(consumer, file), path.join(minimumConsumer, file));
console.log(run(process.execPath, [path.join(minimumConsumer, "node_modules/typescript/bin/tsc"), "-p", minimumConsumer], minimumConsumer));
console.log(run(process.execPath, [path.join(minimumConsumer, "node_modules/vite/bin/vite.js"), "build", minimumConsumer], minimumConsumer));
metadata.threeConsumers.push({ version: minimum, types: minimumTypes, directory: minimumConsumer });
metadata.needleConsumers = [];
const tags = JSON.parse(
    run(
        "npm",
        ["view", "@needle-tools/engine", "dist-tags", "--json"],
        packageRoot,
    ),
);
for (const version of new Set([tags.stable, tags.latest])) {
    const directory = path.join(consumer, `needle-${version}`);
    await fs.mkdir(directory);
    const engineDependencies = JSON.parse(
        run(
            "npm",
            [
                "view",
                `@needle-tools/engine@${version}`,
                "dependencies",
                "--json",
            ],
            packageRoot,
        ),
    );
    await fs.writeFile(
        path.join(directory, "package.json"),
        JSON.stringify(
            {
                name: "gltf-interactivity-packed-needle-consumer",
                private: true,
                type: "module",
                dependencies: {
                    ...Object.fromEntries(
                        artifacts.map((a) => [a.name, a.tarball]),
                    ),
                    "@needle-tools/engine": version,
                    three: engineDependencies.three,
                },
                devDependencies: {
                    "@types/three": "latest",
                    typescript: "^5.9.3",
                    vite: "^7.3.5",
                },
            },
            null,
            2,
        ),
    );
    console.log(
        run(
            "npm",
            ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
            directory,
        ),
    );
    await fs.writeFile(
        path.join(directory, "index.html"),
        '<script type="module" src="/main.ts"></script>',
    );
    await fs.writeFile(
        path.join(directory, "vite.config.mjs"),
        'export default { resolve: { dedupe: ["three"] } };',
    );
    await fs.writeFile(
        path.join(directory, "main.ts"),
        'import "@needle-tools/engine";\nimport { registerNeedleInteractivity } from "three-gltf-interactivity/needle";\nconst unregister: () => void = registerNeedleInteractivity({ onReady(runtime) { runtime.start(); } });\nconsole.log(unregister);\n',
    );
    await fs.writeFile(
        path.join(directory, "tsconfig.json"),
        JSON.stringify({
            compilerOptions: {
                target: "ES2022",
                module: "ESNext",
                moduleResolution: "Bundler",
                strict: true,
                skipLibCheck: true,
                noEmit: true,
            },
            include: ["main.ts"],
        }),
    );
    // Needle's upstream declarations are checked by its SDK; standalone integration declarations
    // are independently checked above with skipLibCheck:false and NodeNext resolution.
    console.log(
        run(
            process.execPath,
            [
                path.join(directory, "node_modules/typescript/bin/tsc"),
                "-p",
                directory,
            ],
            directory,
        ),
    );
    console.log(
        run(
            process.execPath,
            [
                path.join(directory, "node_modules/vite/bin/vite.js"),
                "build",
                directory,
            ],
            directory,
        ),
    );
    metadata.needleConsumers.push({
        version,
        directory,
        three: engineDependencies.three,
        dependencyTree: JSON.parse(run("npm", ["ls", "--json"], directory)),
    });
}
const sourceFiles = run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    repoRoot,
)
    .split("\0")
    .filter(Boolean)
    .sort();
const sourceHash = createHash("sha256");
for (const file of sourceFiles) {
    try {
        sourceHash
            .update(file + "\0")
            .update(await fs.readFile(path.join(repoRoot, file)));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}
metadata.sourceTreeSha256 = sourceHash.digest("hex");
await fs.writeFile(
    path.join(cache, "packed-consumer.json"),
    JSON.stringify(metadata, null, 2),
);
console.log(`Packed consumer verified: ${consumer}`);
