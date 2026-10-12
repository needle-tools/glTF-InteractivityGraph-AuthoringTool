import { CompileError } from "./diagnostics.mjs";
import { compile as parse } from "./compiler/bytecode.mjs";
import { lowerStructuredProgram } from "./compiler/structured-program.mjs";
import { Asset } from "./asset.mjs";
import { validateInteractivityExtension } from "@khronosgroup/gltf-interactivity-engine";
import { GraphBuilder } from "./native.mjs";
export { GraphBuilder, defineGraph } from "./native.mjs";
export { catalog, signatures } from "./catalog.mjs";
export { CompileError, diagnostic } from "./diagnostics.mjs";
export { Asset } from "./asset.mjs";
export function attachGraph(asset, graph, { metadata, heap } = {}) {
  if (heap?.length) asset.ram(heap);
  if (asset.doc.extensions?.KHR_interactivity)
    throw new Error("Input already contains an interactivity graph.");
  const extensions = [
    ...graph.declarations.flatMap((d) => (d.extension ? [d.extension] : [])),
    ...graph.nodes.flatMap(
      (n) =>
        String(n.configuration?.pointer?.value?.[0] ?? "").match(
          /\/extensions\/([^/]+)/,
        )?.[1] ?? [],
    ),
  ];
  for (const n of graph.nodes) {
    const op = graph.declarations[n.declaration].op;
    if (
      ["event/onSelect", "event/onHoverIn", "event/onHoverOut"].includes(op)
    ) {
      const extension =
          op === "event/onSelect"
            ? "KHR_node_selectability"
            : "KHR_node_hoverability",
        index = n.configuration?.nodeIndex?.value[0];
      const nodes =
        index === undefined ? asset.doc.nodes : [asset.doc.nodes[index]];
      for (const target of nodes) {
        if (!target) throw new Error("Unknown event node " + index);
        (target.extensions ??= {})[extension] ??= {};
      }
    }
  }
  asset.doc.extensionsUsed = [
    ...new Set([
      ...(asset.doc.extensionsUsed ?? []),
      "KHR_interactivity",
      ...extensions,
    ]),
  ];
  asset.doc.extensions = {
    ...asset.doc.extensions,
    KHR_interactivity: { graph: 0, graphs: [graph] },
  };
  if (metadata)
    asset.doc.extras = { ...asset.doc.extras, interactivityScript: metadata };
  validateInteractivityExtension(asset.doc.extensions.KHR_interactivity);
  return asset;
}
export function compile(
  source,
  {
    scene,
    entry = "main",
    sourceName = "program.js",
    maxDepth = 24,
    arrayCapacity = 256,
    optimize = true,
  } = {},
) {
  for (const [name, value] of Object.entries({ maxDepth, arrayCapacity }))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new CompileError(
        "IGS_OPTION",
        `${name} must be a positive integer.`,
        { actual: value },
      );
  const asset =
    scene instanceof Asset
      ? Asset.fromGLB(scene.pack())
      : scene
        ? Asset.fromDocument(scene)
        : new Asset();
  const program = parse(source, { scene: asset.doc, arrayCapacity });
  if (!program.bindings.length && !program.functions[entry])
    throw new Error("Unknown entry function " + entry);
  const kernel = lowerStructuredProgram(program, {
    heapNodeBase: asset.doc.nodes.length,
    entry,
    maxDepth,
    optimize,
  });
  const metadata = {
    version: 1,
    backend: "structured",
    source: sourceName,
    globals: kernel.globals,
    vars: kernel.vars,
    heapNodeBase: kernel.heapNodeBase,
    memoryPageSize: 8,
  };
  attachGraph(asset, kernel.g.graph, { heap: kernel.initial, metadata });
  return {
    graph: kernel.g.graph,
    asset,
    metadata,
    statistics: {
      nodes: kernel.g.graph.nodes.length,
      variables: kernel.g.graph.variables.length,
      heapCells: kernel.initial.length,
      functionContexts: kernel.instances.size,
    },
    toGLB: () => asset.pack(),
  };
}
export async function compileGraph(
  author,
  {
    scene,
    name = "Interactivity",
    optimize = true,
    sourceName = "graph.mjs",
  } = {},
) {
  if (typeof author !== "function")
    throw new CompileError(
      "IGS_AUTHOR_MODULE",
      "A graph module must export a default authoring function.",
    );
  const asset =
      scene instanceof Asset
        ? Asset.fromGLB(scene.pack())
        : scene
          ? Asset.fromDocument(scene)
          : new Asset(),
    g = new GraphBuilder({ name, optimize });
  const node = (name) => {
    const hits = asset.doc.nodes.flatMap((n, id) =>
      n.name === name ? [id] : [],
    );
    if (hits.length !== 1)
      throw new Error("Scene node must have a unique name: " + name);
    return hits[0];
  };
  await author({ g, scene: asset.doc, node });
  const graph = g.finish();
  attachGraph(asset, graph, {
    metadata: { version: 1, backend: "native", source: sourceName },
  });
  return {
    graph,
    asset,
    statistics: {
      nodes: graph.nodes.length,
      variables: graph.variables?.length ?? 0,
      heapCells: 0,
    },
    toGLB: () => asset.pack(),
  };
}
