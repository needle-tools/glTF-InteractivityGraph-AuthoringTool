import test from "node:test";
import assert from "node:assert/strict";
import { GraphBuilder } from "../src/index.mjs";
import { Graph } from "../src/compiler/graph.mjs";
import { runGraph } from "./runtime.mjs";

test("sparse valid graphs compose with typed primitives without modifying the input", () => {
  for (const source of [{}, { types: [{ signature: "float" }] }]) {
    const before = structuredClone(source), g = new GraphBuilder({ graph: source });
    const result = g.variable("result", "float", 0);
    g.ops.event.onStart().flow().to(g.set(result, g.float(42)));
    const r = runGraph(g.finish());
    try { assert.deepEqual(r.value("result"), [42]); assert.deepEqual(source, before); }
    finally { r.dispose(); }
  }
});

const seed = used => ({ types: [{ signature: "ref" }, { signature: "int" }, { signature: "float3" }],
  declarations: [{ op: "event/onSelect", extension: "KHR_node_selectability" }],
  ...(used ? { nodes: [{ declaration: 0, configuration: { nodeIndex: { value: [0] } } }] } : {}),
});

test("unused imported partial declarations can be replaced by complete typed interfaces", () => {
  const g = new GraphBuilder({ graph: seed(false) });
  const select = g.ops.event.onSelect({}, { nodeIndex: 0 }), hit = g.variable("hit", "float3");
  select.flow().to(g.set(hit, select.outputs.selectionPoint));
  const graph = g.finish(), r = runGraph(graph);
  try {
    r.engine.select(0, 0, [1, 2, 3], [0, 0, 0]); r.engine.executeEventQueueTick();
    assert.deepEqual(r.value("hit"), [1, 2, 3]);
    assert.equal(graph.declarations.filter(d => d.op === "event/onSelect").length, 1);
  } finally { r.dispose(); }
});

test("used partial declarations fail clearly instead of silently activating imported nodes", () => {
  const original = seed(true), g = new GraphBuilder({ graph: original });
  assert.throws(() => g.ops.event.onSelect({}, { nodeIndex: 0 }), error =>
    error.diagnostic?.code === "IGS_DECLARATION_CONFLICT" && error.diagnostic.operation === "event/onSelect");
  assert.equal(original.declarations[0].outputValueSockets, undefined);
});

test("complete imported declarations are reused; explicit empty extensions remain distinct", () => {
  const a = new GraphBuilder(), first = a.ops.event.onSelect({}, { nodeIndex: 0 });
  const b = new GraphBuilder({ graph: a.finish() });
  b.ops.event.onSelect({}, { nodeIndex: 1 });
  assert.equal(b.finish().declarations.filter(d => d.op === first.op).length, 1);
  const raw = new Graph("empty extension identity");
  raw.node("math/Pi", {}, {}, ""); raw.node("math/Pi");
  assert.equal(raw.graph.declarations.length, 2);
  assert.deepEqual(raw.graph.declarations.map(d => d.extension), ["", undefined]);
});

test("type pruning rebuilds declaration identities using remapped indices", () => {
  const g = new Graph("declaration type remap");
  const node = () => g.node("rigid_body/applyImpulse", {
    nodeIndex: g.literal("int", 0), linearImpulse: g.literal("float3", [1,2,3]), angularImpulse: g.literal("float3", [0,0,0]),
  }, {}, "KHR_physics_rigid_bodies");
  node(); g.pruneTypes(); node();
  assert.equal(g.graph.declarations.length, 1);
  assert.equal(g.graph.nodes[0].declaration, g.graph.nodes[1].declaration);
});
