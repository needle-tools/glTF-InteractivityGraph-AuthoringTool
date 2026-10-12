#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  compile,
  compileGraph,
  Asset,
  catalog,
  diagnostic,
  CompileError,
} from "./index.mjs";
const argv = process.argv.slice(2);
let source,
  filename,
  json = argv.includes("--json");
try {
  const command = ["compile", "check", "catalog"].includes(argv[0])
      ? argv.shift()
      : "compile",
    options = {},
    position = [];
  const allowed = new Set([
    "--out",
    "--scene",
    "--entry",
    "--max-depth",
    "--array-capacity",
    "--steps-per-tick",
    "--op",
    "--format",
  ]);
  for (let j = 0; j < argv.length; j++) {
    const arg = argv[j];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg.startsWith("--")) {
      if (!allowed.has(arg))
        throw new CompileError("IGS_ARGUMENT", "Unknown option " + arg);
      if (!argv[j + 1] || argv[j + 1].startsWith("--"))
        throw new CompileError("IGS_ARGUMENT", "Missing value for " + arg);
      if (Object.hasOwn(options, arg))
        throw new CompileError("IGS_ARGUMENT", "Duplicate option " + arg);
      options[arg] = argv[++j];
    } else position.push(arg);
  }
  if (command === "catalog") {
    const result = options["--op"] ? catalog[options["--op"]] : catalog;
    if (!result)
      throw new CompileError(
        "IGS_ARGUMENT",
        "Unknown operation " + options["--op"],
      );
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (position.length !== 1)
      throw new CompileError(
        "IGS_ARGUMENT",
        "Usage: gltf-interactivity-script [compile|check] input.js [--scene scene.glb|scene.gltf] [--out output.glb] [--entry main] [--json]",
      );
    filename = position[0];
    source = await fs.readFile(filename, "utf8");
    let scene;
    if (options["--scene"]) {
      const bytes = await fs.readFile(options["--scene"]);
      scene = options["--scene"].endsWith(".gltf")
        ? Asset.fromDocument(JSON.parse(bytes.toString()))
        : Asset.fromGLB(bytes);
    }
    const config = {
      scene,
      sourceName: filename,
      entry: options["--entry"] ?? "main",
    };
    for (const [flag, key] of [
      ["--max-depth", "maxDepth"],
      ["--array-capacity", "arrayCapacity"],
    ])
      if (options[flag]) {
        const n = Number(options[flag]);
        if (!Number.isSafeInteger(n) || n < 1)
          throw new CompileError(
            "IGS_ARGUMENT",
            flag + " must be a positive integer.",
          );
        config[key] = n;
      }
    if (options["--steps-per-tick"]) {
      const steps = Number(options["--steps-per-tick"]);
      if (!Number.isSafeInteger(steps) || steps < 1 || steps > 65536)
        throw new CompileError(
          "IGS_ARGUMENT",
          "--steps-per-tick must be an integer from 1 to 65536.",
        );
      config.cooperative = { stepsPerTick: steps };
    }
    if (
      options["--format"] &&
      !["graph", "script"].includes(options["--format"])
    )
      throw new CompileError(
        "IGS_ARGUMENT",
        "--format must be graph or script",
      );
    const native =
        options["--format"] === "graph" || filename.endsWith(".graph.mjs"),
      result = native
        ? await compileGraph(
            (await import(pathToFileURL(path.resolve(filename)).href)).default,
            config,
          )
        : compile(source, config);
    const output =
      options["--out"] ??
      filename.replace(/\.(?:graph\.)?(?:mjs|js)$/, "") + ".glb";
    if (command === "compile") await fs.writeFile(output, result.toGLB());
    console.log(
      json
        ? JSON.stringify({
            ok: true,
            command,
            source: filename,
            ...(command === "compile" ? { output } : {}),
            statistics: result.statistics,
          })
        : `${command === "check" ? "Valid" : `Compiled → ${output}`}: ${result.statistics.nodes} nodes, ${result.statistics.variables} variables`,
    );
  }
} catch (error) {
  const d = diagnostic(error, filename, source);
  console.error(
    json
      ? JSON.stringify({ ok: false, diagnostics: [d] })
      : `${d.code}: ${d.message}${d.line ? "\n" + d.line : ""}`,
  );
  process.exitCode = 1;
}
