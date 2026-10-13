import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
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
const result = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", consumer], packageRoot),
)[0];
const tarball = path.join(consumer, result.filename);
for (const file of ["dist/index.js", "dist/needle.js", "dist/bundled-core.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    assert.ok(result.files.some(entry => entry.path === file), `Missing packed file: ${file}`);
}
const artifacts = [{
    name: result.name,
    version: result.version,
    tarball,
    sha256: createHash("sha256").update(await fs.readFile(tarball)).digest("hex"),
}];
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
    'import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";\nimport { registerGLTFInteractivity, type IInteractivityGraph, type IEventBus } from "three-gltf-interactivity";\nconst graph: IInteractivityGraph = { types: [], declarations: [], nodes: [], events: [], variables: [] };\nfunction configure(eventBus: IEventBus) { return registerGLTFInteractivity(new GLTFLoader(), { eventBus }); }\nregisterGLTFInteractivity(new GLTFLoader()); console.log(graph, configure);\n',
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
const smoke = `
import assert from "node:assert/strict";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getInteractivityRuntime, InteractivityRuntime, registerGLTFInteractivity } from "three-gltf-interactivity";
globalThis.document = new EventTarget();
const loader = new GLTFLoader();
registerGLTFInteractivity(loader);
const fixture = ${JSON.stringify(JSON.parse(await fs.readFile(path.join(packageRoot, "examples/fixture/interactive.gltf"), "utf8")))};
delete fixture.nodes[0].mesh;
for (const key of ["meshes", "accessors", "bufferViews", "buffers"]) delete fixture[key];
fixture.nodes[0].camera = 1;
fixture.nodes.push({ name: "NoCamera" });
fixture.cameras = [0, 1].map(() => ({ type: "perspective", perspective: { yfov: 0.7, znear: 0.1 } }));
const gltf = await loader.parseAsync(JSON.stringify(fixture), "");
const runtime = getInteractivityRuntime(gltf);
try {
    assert.ok(runtime instanceof InteractivityRuntime);
    assert.equal(runtime.model.nodes[0].position.x, 1);
    assert.deepEqual(runtime.decorator.getPathValue("/nodes/0/camera"), ["/cameras/1"]);
    assert.deepEqual(runtime.decorator.getPathValue("/nodes/1/camera"), ["/cameras/0"]);
    assert.equal(runtime.decorator.resolveJsonPtr("/nodes/0/camera").typeName, "ref");
    assert.equal(runtime.decorator.isReadOnly("/nodes/0/camera"), true);
    assert.equal(runtime.decorator.isValidJsonPtr("/nodes/2/camera"), false);
} finally { runtime?.dispose(); }
await assert.rejects(loader.parseAsync(JSON.stringify({ ...fixture, extensions: { KHR_interactivity: { graphs: [] } } }), ""), /Invalid KHR_interactivity/);
console.log("Packed runtime checks passed");
`;
async function verifyInstallation(directory, standalone = false) {
    const lock = JSON.parse(await fs.readFile(path.join(directory, "package-lock.json"), "utf8"));
    assert.ok(!Object.keys(lock.packages).some(file => file.endsWith("node_modules/@khronosgroup/gltf-interactivity-engine")), "Unexpected external core dependency");
    const threeInstances = Object.keys(lock.packages).filter(file => file.endsWith("node_modules/three"));
    assert.equal(threeInstances.length, 1, `Expected one Three instance: ${threeInstances.join(", ")}`);
    const installedRoot = path.join(directory, "node_modules/three-gltf-interactivity");
    const installed = JSON.parse(await fs.readFile(path.join(installedRoot, "package.json"), "utf8"));
    assert.equal(installed.version, artifacts[0].version);
    assert.equal(installed.dependencies["@khronosgroup/gltf-interactivity-engine"], undefined);
    const installedArtifact = lock.packages["node_modules/three-gltf-interactivity"];
    assert.ok(installedArtifact.resolved.startsWith("file:") && !installedArtifact.link, "Expected a tarball installation");
    assert.equal(path.resolve(directory, installedArtifact.resolved.slice(5)), artifacts[0].tarball);
    const bundledCore = JSON.parse(await fs.readFile(path.join(installedRoot, "dist/bundled-core.json"), "utf8"));
    assert.equal(bundledCore.name, "@khronosgroup/gltf-interactivity-engine");
    if (standalone) {
        await fs.writeFile(path.join(directory, "smoke.mjs"), smoke);
        console.log(run(process.execPath, ["smoke.mjs"], directory));
    }
    return bundledCore;
}
metadata.bundledCore = await verifyInstallation(consumer, true);
const publishOutput = JSON.parse(run("npm", ["publish", artifacts[0].tarball, "--access", "public", "--dry-run", "--json"], packageRoot));
const published = publishOutput.name ? publishOutput : publishOutput[artifacts[0].name];
assert.equal(published.name, artifacts[0].name);
assert.equal(published.version, artifacts[0].version);
metadata.publishDryRun = true;
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
await verifyInstallation(minimumConsumer, true);
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
    await verifyInstallation(directory);
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
