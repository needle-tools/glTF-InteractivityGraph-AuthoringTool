import test from "node:test";
import assert from "node:assert/strict";
import {
  GraphBuilder,
  catalog,
  CompileError,
  compileGraph,
} from "../src/index.mjs";
import { runGraph } from "./runtime.mjs";
test("native vectors, matrices and inferred output types execute through the real core", () => {
  const g = new GraphBuilder(),
    scalar = g.variable("dot", "float", 0),
    vector = g.variable("point", "float4", [0, 0, 0, 0]),
    matrix = g.variable("matrix", "float4x4", Array(16).fill(0));
  const dot = g.ops.math.dot({
      a: g.float3([1, 2, 3]),
      b: g.float3([1, 2, 3]),
    }),
    compose = g.ops.math.matCompose({
      translation: g.float3([2, 3, 4]),
      rotation: g.float4([0, 0, 0, 1]),
      scale: g.float3([1, 1, 1]),
    }),
    point = g.ops.math.transform({
      a: g.float4([1, 1, 1, 1]),
      b: compose.outputs.value,
    });
  g.ops.event
    .onStart()
    .flow()
    .to(
      g.sequence(
        g.set(scalar, dot.outputs.value),
        g.set(vector, point.outputs.value),
        g.set(matrix, compose.outputs.value),
      ),
    );
  const r = runGraph(g.finish());
  try {
    assert.deepEqual(r.value("dot"), [14]);
    assert.deepEqual(r.value("point"), [3, 4, 5, 1]);
    assert.deepEqual(r.value("matrix").slice(12, 15), [2, 3, 4]);
  } finally {
    r.dispose();
  }
});
test("timer done flow runs independently of its immediate continuation", async () => {
  const g = new GraphBuilder(),
    immediate = g.variable("immediate", "int", 0),
    completed = g.variable("completed", "int", 0),
    token = g.variable("token", "ref", ""),
    delay = g.ops.flow.setDelay({ duration: g.float(0.01) });
  g.ops.event.onStart().flow().to(delay);
  delay
    .flow("out")
    .to(
      g.sequence(
        g.set(immediate, g.int(1)),
        g.set(token, delay.outputs.lastDelay),
      ),
    );
  delay.flow("done").to(g.set(completed, g.int(1)));
  const r = runGraph(g.finish());
  try {
    assert.deepEqual(r.value("immediate"), [1]);
    assert.deepEqual(r.value("completed"), [0]);
    assert.match(
      r.value("token")[0],
      /^\/extensions\/KHR_interactivity\/delays\//,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    r.engine.executeEventQueueTick();
    assert.deepEqual(r.value("completed"), [1]);
  } finally {
    r.dispose();
  }
});
test("all catalogue primitives expose named constructors and useful typed diagnostics", () => {
  const g = new GraphBuilder();
  for (const op of Object.keys(catalog)) {
    const [domain, name] = op.split("/");
    assert.equal(typeof g.ops[domain][name], "function");
  }
  assert.throws(
    () => g.ops.math.dot({ a: g.float(1), b: g.float(2) }),
    (error) =>
      error instanceof CompileError &&
      error.diagnostic.code === "IGS_SOCKET_TYPE" &&
      error.diagnostic.socket === "a",
  );
  assert.throws(
    () => g.ops.math.add({ a: g.float(1), b: g.int(2) }),
    (error) => error.diagnostic.code === "IGS_TYPE_GROUP",
  );
  assert.throws(
    () => g.ops.math.add({ a: g.float(1) }),
    (error) => error.diagnostic.code === "IGS_REQUIRED_SOCKET",
  );
  assert.throws(
    () => g.ops.math.sin({ a: new GraphBuilder().float(1) }),
    (error) => error.diagnostic.code === "IGS_OWNER",
  );
});
test("write fusion preserves random sampling at separate flow boundaries", () => {
  const original = Math.random;
  let calls = 0;
  Math.random = () => ++calls / 10;
  try {
    const g = new GraphBuilder(),
      a = g.variable("a", "float", 0),
      b = g.variable("b", "float", 0),
      random = g.ops.math.random().outputs.value,
      first = g.set(a, random),
      second = g.set(b, random);
    g.ops.event.onStart().flow().to(first);
    first.flow().to(second);
    const r = runGraph(g.finish());
    try {
      assert.deepEqual(r.value("a"), [0.1]);
      assert.deepEqual(r.value("b"), [0.2]);
      assert.equal(calls, 2);
    } finally {
      r.dispose();
    }
  } finally {
    Math.random = original;
  }
});

test("typed custom events carry vector and reference payloads through the core", () => {
  const g = new GraphBuilder(),
    event = g.event("hit", { point: "float3", target: "ref" }),
    position = g.variable("position", "float3", [0, 0, 0]),
    target = g.variable("target", "ref", ""),
    received = g.receive(event);
  received
    .flow()
    .to(
      g.sequence(
        g.set(position, received.outputs.point),
        g.set(target, received.outputs.target),
      ),
    );
  g.ops.event
    .onStart()
    .flow()
    .to(
      g.send(event, { point: g.float3([1, 2, 3]), target: g.ref("/nodes/4") }),
    );
  const r = runGraph(g.finish());
  try {
    r.engine.executeEventQueueTick();
    assert.deepEqual(r.value("position"), [1, 2, 3]);
    assert.deepEqual(r.value("target"), ["/nodes/4"]);
  } finally {
    r.dispose();
  }
});
test("native graph-only GLBs omit empty buffers and preserve vector signed zero", async () => {
  const result = await compileGraph(({ g }) => {
    const state = g.variable("vector", "float3", [0, 0, 0]);
    g.ops.event
      .onStart()
      .flow()
      .to(g.set(state, g.float3([-0, 1, 2])));
  });
  const bytes = Buffer.from(result.toGLB()),
    len = bytes.readUInt32LE(12),
    doc = JSON.parse(bytes.subarray(20, 20 + len));
  assert.equal(bytes.length, 20 + len);
  assert.equal(doc.buffers, undefined);
  const r = runGraph(doc.extensions.KHR_interactivity.graphs[0]);
  try {
    assert.ok(Object.is(r.value("vector")[0], -0));
  } finally {
    r.dispose();
  }
});

test("public node and value handles retain correct indices after topological ordering", () => {
  const g = new GraphBuilder(),
    result = g.variable("result", "float", 0),
    start = g.ops.event.onStart(),
    branch = g.ops.flow.branch({ condition: g.bool(true) }),
    sin = g.ops.math.sin({ a: g.float(Math.PI / 2) }),
    value = sin.outputs.value;
  start.flow().to(branch);
  branch.flow("true").to(g.set(result, value));
  const graph = g.finish();
  assert.equal(
    graph.declarations[graph.nodes[value.edge.node].declaration].op,
    "math/sin",
  );
  assert.equal(sin.id, value.edge.node);
  assert.equal(
    graph.declarations[graph.nodes[branch.id].declaration].op,
    "flow/branch",
  );
  const r = runGraph(graph);
  try {
    assert.deepEqual(r.value("result"), [1]);
  } finally {
    r.dispose();
  }
});

test('native composition extends a private graph while preserving variable metadata', () => {
  const original = new GraphBuilder();
  const first = original.variable('original', 'int', 0);
  original.ops.event.onStart().flow().to(original.set(first, original.int(7)));
  const base = original.finish();
  const snapshot = structuredClone(base);
  const extension = new GraphBuilder({ graph: base });
  const second = extension.variable('extension', 'float3', [0, 0, 0]);
  extension.ops.event.onStart().flow().to(extension.set(second, extension.float3([1, 2, 3])));
  const graph = extension.finish();
  assert.deepEqual(base, snapshot);
  assert.deepEqual(graph.variables[first.id], base.variables[first.id]);
  const runtime = runGraph(graph);
  try {
    assert.deepEqual(runtime.value('original'), [7]);
    assert.deepEqual(runtime.value('extension'), [1, 2, 3]);
  } finally {
    runtime.dispose();
  }
});
