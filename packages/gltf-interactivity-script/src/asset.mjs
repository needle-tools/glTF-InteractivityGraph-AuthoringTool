export class Asset {
  constructor() {
    this.doc = {
      asset: { version: "2.0", generator: "gltf-interactivity-script" },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      materials: [],
      meshes: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
    };
    this.chunks = [];
    this.length = 0;
  }
  static fromGLB(bytes) {
    bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.readUInt32LE(0) !== 0x46546c67 ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length
    )
      throw new Error("Expected a glTF 2.0 GLB");
    const asset = new Asset(),
      length = bytes.readUInt32LE(12);
    asset.doc = JSON.parse(bytes.subarray(20, 20 + length).toString());
    if (
      asset.doc.buffers?.some((buffer) => buffer.uri) ||
      asset.doc.buffers?.length > 1
    )
      throw new Error("The input GLB must embed one buffer");
    if (20 + length < bytes.length) {
      if (bytes.readUInt32LE(24 + length) !== 0x004e4942)
        throw new Error("Expected a BIN chunk");
      const binary = bytes.subarray(
        28 + length,
        28 + length + bytes.readUInt32LE(20 + length),
      );
      asset.chunks = [binary];
      asset.length = binary.length;
    }
    if (asset.doc.extensions?.KHR_interactivity)
      throw new Error("Input scene already contains a behavior graph");
    asset.doc.nodes ??= [];
    asset.doc.meshes ??= [];
    asset.doc.accessors ??= [];
    asset.doc.bufferViews ??= [];
    asset.doc.buffers ??= [];
    return asset;
  }
  static fromDocument(document) {
    const asset = new Asset();
    asset.doc = structuredClone(document);
    if (asset.doc.asset?.version !== "2.0")
      throw new Error("Expected a glTF 2.0 document");
    if (asset.doc.extensions?.KHR_interactivity)
      throw new Error("Input already contains an interactivity graph");
    if ((asset.doc.buffers ?? []).length > 1)
      throw new Error("Use a GLB or a glTF with one embedded buffer");
    const buffer = asset.doc.buffers?.[0];
    if (buffer) {
      if (!/^data:.*;base64,/.test(buffer.uri ?? ""))
        throw new Error(
          "Scene buffers must be embedded; use a GLB for external buffers",
        );
      const bytes = Buffer.from(
        buffer.uri.slice(buffer.uri.indexOf(",") + 1),
        "base64",
      );
      if (bytes.length !== buffer.byteLength)
        throw new Error("Embedded buffer length mismatch");
      asset.chunks = [bytes];
      asset.length = bytes.length;
      delete buffer.uri;
    }
    asset.doc.nodes ??= [];
    asset.doc.scenes ??= [{ nodes: [] }];
    asset.doc.scene ??= 0;
    asset.doc.scenes[asset.doc.scene].nodes ??= [];
    for (const key of [
      "meshes",
      "materials",
      "accessors",
      "bufferViews",
      "buffers",
    ])
      asset.doc[key] ??= [];
    return asset;
  }
  material(name, color, { metallic = 0, roughness = 0.4, unlit = false } = {}) {
    const id = this.doc.materials.length;
    this.doc.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [...color, 1],
        metallicFactor: metallic,
        roughnessFactor: roughness,
      },
      ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
    });
    return id;
  }
  accessor(array, type, target) {
    const padding = (4 - (this.length % 4)) % 4;
    if (padding) {
      this.chunks.push(Buffer.alloc(padding));
      this.length += padding;
    }
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const view = this.doc.bufferViews.length;
    this.doc.bufferViews.push({
      buffer: 0,
      byteOffset: this.length,
      byteLength: bytes.length,
      target,
    });
    this.chunks.push(bytes);
    this.length += bytes.length;
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const accessor = {
      bufferView: view,
      componentType:
        array instanceof Float32Array
          ? 5126
          : array instanceof Uint32Array
            ? 5125
            : 5123,
      count: array.length / components,
      type,
    };
    if (type === "VEC3") {
      accessor.min = Array.from({ length: 3 }, (_, c) =>
        Math.min(
          ...Array.from({ length: accessor.count }, (_, i) => array[i * 3 + c]),
        ),
      );
      accessor.max = Array.from({ length: 3 }, (_, c) =>
        Math.max(
          ...Array.from({ length: accessor.count }, (_, i) => array[i * 3 + c]),
        ),
      );
    }
    this.doc.accessors.push(accessor);
    return this.doc.accessors.length - 1;
  }
  mesh(geometry, material, name) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const attributes = {
      POSITION: this.accessor(
        geometry.attributes.position.array,
        "VEC3",
        34962,
      ),
      NORMAL: this.accessor(geometry.attributes.normal.array, "VEC3", 34962),
    };
    const uv = geometry.attributes.uv;
    if (uv) attributes.TEXCOORD_0 = this.accessor(uv.array, "VEC2", 34962);
    const color = geometry.attributes.color;
    if (color) {
      if (![3, 4].includes(color.itemSize))
        throw new Error("Vertex colors require RGB or RGBA attributes");
      attributes.COLOR_0 = this.accessor(
        color.array, color.itemSize === 4 ? "VEC4" : "VEC3", 34962,
      );
    }
    const primitive = { attributes, material };
    if (geometry.index)
      primitive.indices = this.accessor(geometry.index.array, "SCALAR", 34963);
    this.doc.meshes.push({ name, primitives: [primitive] });
    geometry.dispose();
    return this.doc.meshes.length - 1;
  }
  node(name, properties = {}, parent) {
    const id = this.doc.nodes.length;
    this.doc.nodes.push({ name, ...properties });
    if (parent === undefined) this.doc.scenes[0].nodes.push(id);
    else (this.doc.nodes[parent].children ??= []).push(id);
    return id;
  }
  ram(values) {
    const base = this.doc.nodes.length,
      position = this.accessor(new Float32Array(9), "VEC3", 34962),
      mesh = this.doc.meshes.length;
    this.doc.meshes.push({
      name: "Non-rendering memory page",
      primitives: [
        {
          attributes: { POSITION: position },
          targets: Array.from({ length: 8 }, () => ({ POSITION: position })),
        },
      ],
      weights: Array(8).fill(0),
    });
    for (let index = 0; index < values.length; index += 8)
      this.doc.nodes.push({
        name: "Memory page " + index / 8,
        mesh,
        weights: Array.from({ length: 8 }, (_, i) => values[index + i] ?? 0),
      });
    return base;
  }
  pack() {
    const bin = Buffer.concat(this.chunks),
      document = structuredClone(this.doc);
    if (bin.length) document.buffers = [{ byteLength: bin.length }];
    else delete document.buffers;
    for (const key of [
      "nodes",
      "materials",
      "meshes",
      "accessors",
      "bufferViews",
      "buffers",
    ])
      if (document[key]?.length === 0) delete document[key];
    for (const scene of document.scenes ?? [])
      if (scene.nodes?.length === 0) delete scene.nodes;
    const json = Buffer.from(
      JSON.stringify(document, (_, v) =>
        typeof v === "number" && Object.is(v, -0) ? JSON.rawJSON("-0") : v,
      ),
    );
    const jl = (json.length + 3) & ~3,
      bl = (bin.length + 3) & ~3,
      out = Buffer.alloc(20 + jl + (bin.length ? 8 + bl : 0));
    out.writeUInt32LE(0x46546c67);
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(out.length, 8);
    out.writeUInt32LE(jl, 12);
    out.writeUInt32LE(0x4e4f534a, 16);
    out.fill(32, 20, 20 + jl);
    json.copy(out, 20);
    if (bin.length) {
      out.writeUInt32LE(bl, 20 + jl);
      out.writeUInt32LE(0x004e4942, 24 + jl);
      bin.copy(out, 28 + jl);
    }
    return out;
  }
}
