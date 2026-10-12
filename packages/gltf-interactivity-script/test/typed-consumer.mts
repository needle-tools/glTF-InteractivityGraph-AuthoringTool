import { GraphBuilder, defineGraph, compile } from "../src/index.mjs";
const g = new GraphBuilder();
const start = g.ops.event.onStart();
const a = g.float3([1, 2, 3]);
const dot = g.ops.math.dot({ a, b: a });
const result = g.variable("result", "float");
start.flow().to(g.set(result, dot.outputs.value));
const composed = g.ops.math.matCompose({
  translation: a,
  rotation: g.float4([0, 0, 0, 1]),
  scale: a,
});
g.ops.math.matDecompose({ a: composed.outputs.value }).outputs
  .translation satisfies import("../src/index.mjs").Value<"float3">;
// @ts-expect-error: dot takes vectors.
g.ops.math.dot({ a: g.float(1), b: g.float(2) });
// @ts-expect-error: grouped inputs must have the same type.
g.ops.math.add({ a: g.float3([1, 2, 3]), b: g.float(1) });
// @ts-expect-error: a float variable cannot receive a vector.
g.set(result, a);
// @ts-expect-error: a data node cannot be activated by a flow.
start.flow().to(dot);
// @ts-expect-error: branch has no 'done' output.
g.ops.flow.branch({ condition: g.bool(true) }).flow("done");
compile("function main(){}");
defineGraph(({ g }) => {
  g.ops.event.onStart();
});

const hit = g.event("hit", { point: "float3", target: "ref" });
g.receive(hit).outputs
  .point satisfies import("../src/index.mjs").Value<"float3">;
g.send(hit, { point: a, target: g.ref("/nodes/0") });
// @ts-expect-error: event payload must match its declared types.
g.send(hit, { point: g.float(1), target: g.ref("/nodes/0") });

compile("function main(){}", {cooperative: {stepsPerTick: 64, stackCapacity: 512}});
// @ts-expect-error: cooperative work budgets require numbers.
compile("function main(){}", {cooperative: {stepsPerTick: "64"}});
