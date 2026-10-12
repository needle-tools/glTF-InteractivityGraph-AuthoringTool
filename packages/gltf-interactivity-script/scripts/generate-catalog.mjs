import fs from "node:fs/promises";
import { createRequire } from "node:module";
const root = new URL("../../../", import.meta.url),
  require = createRequire(new URL("src/BasicBehaveEngine/package.json", root));
const { rollup } = await import(require.resolve("rollup")),
  { babel } = await import(require.resolve("@rollup/plugin-babel")),
  { nodeResolve } = await import(
    require.resolve("@rollup/plugin-node-resolve")
  );
const bundle = await rollup({
  input: new URL("src/authoring/spec/nodes.ts", root).pathname,
  plugins: [
    nodeResolve({ extensions: [".ts", ".js"] }),
    babel({
      babelHelpers: "bundled",
      extensions: [".ts"],
      presets: [
        [
          require.resolve("@babel/preset-typescript"),
          { allowDeclareFields: true },
        ],
      ],
    }),
  ],
});
const { output } = await bundle.generate({ format: "es" });
const { interactivityNodeSpecs, standardTypes } = await import(
  "data:text/javascript;base64," +
    Buffer.from(output[0].code).toString("base64")
);
await bundle.close();
const types = standardTypes.map((t) => t.signature),
  catalog = {};
const sockets = (values) =>
  Object.fromEntries(
    Object.entries(values ?? {}).map(([name, s]) => [
      name,
      {
        types: (s.typeOptions ?? [s.type]).map((n) => types[n]).filter(Boolean),
        ...(s.typeGroup ? { group: s.typeGroup } : {}),
      },
    ]),
  );
for (const s of interactivityNodeSpecs)
  catalog[s.op] = {
    description: s.description ?? "",
    ...(s.extension ? { extension: s.extension } : {}),
    inputs: sockets(s.values?.input),
    outputs: sockets(s.values?.output),
    flowInputs: Object.keys(s.flows?.input ?? {}),
    flowOutputs: Object.keys(s.flows?.output ?? {}),
    flags: s.flags ?? [],
    configuration: Object.fromEntries(
      Object.entries(s.configuration ?? {}).map(([n, c]) => [
        n,
        {
          type: c.type,
          description: c.description ?? "",
          ...(c.value?.every(
            (v) =>
              v !== undefined && Number.isFinite(typeof v === "number" ? v : 0),
          )
            ? { default: c.value }
            : {}),
        },
      ]),
    ),
  };
await fs.writeFile(
  new URL("../src/catalog.mjs", import.meta.url),
  "// Generated from src/authoring/spec/nodes.ts. One operation per line.\nexport const signatures = " +
    JSON.stringify(types) +
    ";\nexport const catalog = Object.freeze({\n" +
    Object.entries(catalog)
      .map(([op, s]) => "  " + JSON.stringify(op) + ": " + JSON.stringify(s))
      .join(",\n") +
    "\n});\n",
);
await fs.writeFile(
  new URL("../src/catalog.d.mts", import.meta.url),
  'import type {Signature} from "./index.mjs";\nexport interface OperationDescription { readonly description:string; readonly extension?:string; readonly inputs:Readonly<Record<string,{readonly types:readonly Signature[];readonly group?:string}>>; readonly outputs:Readonly<Record<string,{readonly types:readonly Signature[];readonly group?:string}>>; readonly flowInputs:readonly string[]; readonly flowOutputs:readonly string[]; readonly flags:readonly string[]; readonly configuration:Readonly<Record<string,{readonly type:string;readonly description:string;readonly default?:readonly unknown[]}>>; }\nexport const signatures: readonly Signature[];\nexport const catalog: Readonly<Record<string,OperationDescription>>;\n',
);
console.log("Generated", Object.keys(catalog).length, "primitive descriptions");
const union = (a) =>
  a.length ? a.map((s) => JSON.stringify(s)).join(" | ") : "never";
const configuration = (s) =>
  Object.keys(s.configuration).length
    ? "{ " +
      Object.entries(s.configuration)
        .map(
          ([n, c]) =>
            JSON.stringify(n) +
            "?: " +
            (n === "type"
              ? "Signature | number"
              : c.type === "int[]"
                ? "readonly number[]"
                : c.type === "int"
                  ? "number"
                  : c.type === "bool"
                    ? "boolean"
                    : "string"),
        )
        .join("; ") +
      " }"
    : "Record<string, never>";
const dynamicInputs = new Set([
  "variable/set",
  "event/send",
  "pointer/get",
  "pointer/set",
  "pointer/interpolate",
  "debug/log",
  "math/switch",
]);
const domains = {};
for (const [op, s] of Object.entries(catalog)) {
  const [domain, name] = op.split("/"),
    groups = {};
  for (const [key, v] of Object.entries(s.inputs))
    if (v.group) (groups[v.group] ??= []).push([key, v]);
  const generics = Object.entries(groups).map(
    ([name, entries]) => name + " extends " + union(entries[0][1].types),
  );
  const seen = new Set();
  const inputEntries = Object.entries(s.inputs).map(([key, v]) => {
    let type = union(v.types);
    if (v.group) {
      type = seen.has(v.group) ? `NoInfer<${v.group}>` : v.group;
      seen.add(v.group);
    }
    if (op === "math/transform" && key === "b")
      type =
        'T extends "float2" ? "float2x2" : T extends "float3" ? "float3x3" : "float4x4"';
    return JSON.stringify(key) + ": Value<" + type + ">";
  });
  const inputType = dynamicInputs.has(op)
    ? (inputEntries.length ? "{" + inputEntries.join(";") + "} & " : "") +
      "Record<string, Value<Signature>>"
    : inputEntries.length
      ? "{" + inputEntries.join(";") + "}"
      : "Record<string, never>";
  let output = Object.entries(s.outputs).map(
    ([n, v]) =>
      JSON.stringify(n) +
      ": " +
      (v.group && groups[v.group] ? v.group : union(v.types)),
  );
  if (["event/receive", "variable/get", "pointer/get"].includes(op))
    output.push("[socket:string]: Signature");
  const method =
    JSON.stringify(name) +
    (generics.length ? "<" + generics.join(",") + ">" : "") +
    "(inputs" +
    (inputEntries.length ? "" : "?") +
    ": " +
    inputType +
    ", configuration?: " +
    configuration(s) +
    ", options?: NodeOptions): GraphNode<{" +
    output.join(";") +
    "}, " +
    union(s.flowInputs) +
    ", " +
    (["flow/sequence", "flow/multiGate", "flow/switch"].includes(op)
      ? "string"
      : union(s.flowOutputs)) +
    ">;";
  (domains[domain] ??= []).push(method);
}
await fs.writeFile(
  new URL("../src/ops.d.mts", import.meta.url),
  '// Generated primitive APIs. Requires TypeScript 5.4+ for NoInfer.\nimport type {Value,Signature,GraphNode,NodeOptions} from "./index.mjs";\nexport interface NativeOps {\n' +
    Object.entries(domains)
      .map(
        ([domain, methods]) =>
          "  " +
          JSON.stringify(domain) +
          ": {\n" +
          methods.map((s) => "    " + s).join("\n") +
          "\n  };",
      )
      .join("\n") +
    "\n}\n",
);

const globalsURL = new URL("../src/globals.d.mts", import.meta.url);
let globals = await fs.readFile(globalsURL, "utf8");
const prefix =
  globals.slice(0, globals.indexOf("interface EventOptions")) +
  globals.match(/interface EventOptions \{[^}]*\}/)[0];
const scalar = Object.entries(catalog).filter(
  ([op, s]) =>
    op.startsWith("math/") &&
    op !== "math/switch" &&
    s.outputs.value?.types.some((t) => ["float", "int", "bool"].includes(t)) &&
    Object.values(s.inputs).every((v) =>
      v.types.some((t) => ["float", "int", "bool"].includes(t)),
    ),
);
const methods = scalar
  .map(
    ([op, s]) =>
      JSON.stringify(op.split("/")[1]) +
      ": (" +
      Object.keys(s.inputs)
        .map((n, j) => "arg" + j + ":number")
        .join(",") +
      ")=>number;",
  )
  .join("\n");
await fs.writeFile(
  globalsURL,
  prefix +
    "\n  // Generated scalar primitives\n  const math: {\n" +
    methods +
    "\n};\n}\n",
);
