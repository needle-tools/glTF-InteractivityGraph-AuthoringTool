import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Compile the installed artifact's examples, so this also checks package contents.
const consumer = path.resolve(process.argv[2] ?? ".cache/consumer");
const entry = new URL(execFileSync(process.execPath, [
  "--input-type=module", "-e",
  'process.stdout.write(import.meta.resolve("gltf-interactivity-script"))',
], { cwd: consumer, encoding: "utf8" }));
const root = new URL("../examples/", entry);
const { examples } = await import(new URL("index.mjs", root));
const cli = fileURLToPath(new URL("../src/cli.mjs", root));
for (const example of examples) {
  const directory = path.join(consumer, "examples", example.name);
  await fs.mkdir(directory, { recursive: true });
  const output = execFileSync(process.execPath, [
    cli, "compile", fileURLToPath(new URL(example.source, root)),
    "--scene", fileURLToPath(new URL(example.scene, root)),
    "--out", path.join(directory, "example.glb"), "--json",
  ], { cwd: consumer, encoding: "utf8" });
  const result = JSON.parse(output);
  console.log(`${example.name}: ${result.statistics.nodes} nodes → examples/${example.name}/example.glb`);
}
const shared = path.join(consumer, "examples", "_shared");
await fs.mkdir(shared, { recursive: true });
for (const file of ["viewer.html", "viewer.mjs"])
  await fs.copyFile(new URL(`_shared/${file}`, root), path.join(shared, file));
console.log("Viewer: /examples/_shared/viewer.html?asset=../surface-cursor/example.glb");
