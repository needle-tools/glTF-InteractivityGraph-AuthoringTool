import { defineGraph } from "gltf-interactivity-script";
export default defineGraph(({ g, node }) => {
  const select = g.ops.event.onSelect(
    {},
    { nodeIndex: node("Target") },
    { label: "Surface hit" },
  );
  const cursor = node("Cursor");
  const place = g.write(
    "float3",
    "/nodes/[cursor]/translation",
    select.outputs.selectionPoint,
    { cursor: g.int(cursor) },
  );
  select.flow().to(place);
  const selected = g.variable("selected node", "ref", "");
  place.flow().to(g.set(selected, select.outputs.selectedNode));
});
