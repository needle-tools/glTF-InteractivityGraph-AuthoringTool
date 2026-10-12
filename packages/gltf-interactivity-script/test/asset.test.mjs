import test from "node:test";
import assert from "node:assert/strict";
import { Asset } from "../src/index.mjs";

test("packed mesh retains RGBA vertex colors and alpha values", () => {
  const a = new Asset();
  const material = a.material("Shadow", [0, 0, 0], { unlit: true });
  const colors = new Float32Array([1, 1, 1, 1, 1, 1, 1, 0.5, 1, 1, 1, 0]);
  const mesh = a.mesh(
    {
      attributes: {
        position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]) },
        normal: { array: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]) },
        color: { array: colors, itemSize: 4 },
      },
      dispose() {},
    },
    material,
    "Radial shadow",
  );
  a.node("Shadow", { mesh });
  const packed = Asset.fromGLB(a.pack()),
    accessor =
      packed.doc.accessors[
        packed.doc.meshes[0].primitives[0].attributes.COLOR_0
      ];
  assert.equal(accessor.type, "VEC4");
  assert.equal(accessor.count, 3);
  assert.equal(accessor.componentType, 5126);
  const view = packed.doc.bufferViews[accessor.bufferView],
    buffer = packed.chunks[0];
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) =>
      buffer.readFloatLE(view.byteOffset + i * 4),
    ),
    Array.from(colors),
  );
});
