import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const run = (...args) =>
  spawnSync(
    process.execPath,
    [new URL("../src/cli.mjs", import.meta.url).pathname, ...args],
    { encoding: "utf8" },
  );
test("CLI reports argument and syntax diagnostics as one JSON object with nonzero status", async () => {
  const invalid = run("--unknown", "value", "--json");
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).diagnostics[0].code, "IGS_ARGUMENT");
  assert.equal(invalid.stdout, "");
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "interactivity-script-cli-"),
  );
  try {
    const source = path.join(dir, "bad.js");
    await fs.writeFile(source, "function main() {\n return @;\n}");
    const result = run("check", source, "--json");
    assert.equal(result.status, 1);
    const diagnostic = JSON.parse(result.stderr).diagnostics[0];
    assert.equal(diagnostic.code, "IGS_SOURCE");
    assert.equal(diagnostic.range.start.line, 2);
    assert.equal(diagnostic.range.start.column, 9);
    assert.equal(diagnostic.source, source);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});
