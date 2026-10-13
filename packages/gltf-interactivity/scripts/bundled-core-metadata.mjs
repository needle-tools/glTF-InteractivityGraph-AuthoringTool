import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");
const coreRoot = path.join(repoRoot, "src/BasicBehaveEngine");
const core = JSON.parse(await fs.readFile(path.join(coreRoot, "package.json"), "utf8"));
const files = [];
async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (["build", "node_modules", ".git"].includes(entry.name)) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.name.endsWith(".ts") || ["package.json", "LICENSE"].includes(entry.name)) files.push(file);
    }
}
await walk(coreRoot);
const hash = createHash("sha256");
for (const file of files.sort()) {
    hash.update(path.relative(coreRoot, file) + "\0").update(await fs.readFile(file));
}
const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
await fs.writeFile(path.join(packageRoot, "dist/bundled-core.json"), JSON.stringify({
    name: core.name,
    version: core.version,
    license: core.license,
    upstream: "https://github.com/KhronosGroup/glTF-InteractivityGraph-AuthoringTool",
    coreRevision: git("log", "-1", "--format=%H", "--", "src/BasicBehaveEngine"),
    sourceSha256: hash.digest("hex"),
    modified: git("status", "--porcelain", "--", "src/BasicBehaveEngine") !== "",
}, null, 2) + "\n");
