import { defineGraph } from "gltf-interactivity-script";
export default defineGraph(({ g, node }) => {
  const transform = g.ops.math.matCompose({
    translation: g.float3([0, 0.4, 0]),
    rotation: g.float4([0, 0, 0, 1]),
    scale: g.float3([1, 1, 1]),
  });
  const point = g.ops.math.transform({
    a: g.float4([0.5, 0, 0, 1]),
    b: transform.outputs.value,
  });
  const components = g.ops.math.extract4({ a: point.outputs.value });
  const position = g.ops.math.combine3({
    a: components.outputs["0"],
    b: components.outputs["1"],
    c: components.outputs["2"],
  });
  g.ops.event
    .onStart()
    .flow()
    .to(
      g.write("float3", "/nodes/[cursor]/translation", position.outputs.value, {
        cursor: g.int(node("Cursor")),
      }),
    );
});
