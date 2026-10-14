import { Graph, declarationKey } from "./compiler/graph.mjs";
import { catalog, signatures } from "./catalog.mjs";
import { fail } from "./diagnostics.mjs";
import { validateInteractivityGraph } from "@khronosgroup/gltf-interactivity-engine";
const width = {
  bool: 1,
  int: 1,
  float: 1,
  float2: 2,
  float3: 3,
  float4: 4,
  float2x2: 4,
  float3x3: 9,
  float4x4: 16,
  ref: 1,
};
const scalarDefault = (type) =>
  type === "bool" ? false : type === "ref" ? "" : 0;
export class GraphBuilder {
  constructor({ name = "Interactivity", optimize = true, graph } = {}) {
    this.raw = new Graph(name);
    if (graph) {
      validateInteractivityGraph(graph);
      // Extend a private copy. Existing variable/event indices remain stable,
      // including compiler metadata held by the consumer.
      this.raw.graph = structuredClone(graph);
      for (const key of ["types", "variables", "declarations", "nodes"]) this.raw.graph[key] ??= [];
      for (const signature of signatures)
        if (this.raw.type(signature) < 0)
          this.raw.graph.types.push({ signature });
      this.raw.graph.declarations.forEach((d, i) =>
        this.raw.declarations.set(declarationKey(d), i),
      );
    }
    this.optimize = optimize;
    this.closed = false;
    this.handles = [];
    this.edges = new Set();
    this.ops = {};
    for (const op of Object.keys(catalog)) {
      const [domain, operation] = op.split("/");
      (this.ops[domain] ??= {})[operation] = (
        inputs = {},
        configuration = {},
        options = {},
      ) => this.node(op, inputs, configuration, options);
    }
  }
  assertOpen() {
    if (this.closed)
      fail("IGS_FINALIZED", "The graph has already been compiled.");
  }
  wrap(edge, type) {
    this.edges.add(edge);
    return Object.freeze({ type, edge, owner: this });
  }
  literal(type, value) {
    this.assertOpen();
    if (!signatures.includes(type))
      fail("IGS_TYPE", "Unknown value type " + type, { expected: signatures });
    if (type === "float" && Object.is(value, -0))
      return this.node("math/neg", { a: this.float(0) }).outputs.value;
    const parts = Array.isArray(value) ? value : [value];
    if (parts.length !== width[type])
      fail("IGS_VALUE_WIDTH", `${type} needs ${width[type]} components.`, {
        expected: width[type],
        actual: parts.length,
      });
    if (
      parts.some((v) =>
        type === "bool"
          ? typeof v !== "boolean"
          : type === "ref"
            ? typeof v !== "string"
            : typeof v !== "number" ||
              !Number.isFinite(v) ||
              (type === "int" && v !== (v | 0)),
      )
    )
      fail(
        "IGS_LITERAL",
        `Invalid ${type} literal. Use math operations for nonfinite values.`,
        { type },
      );
    return this.wrap(this.raw.literal(type, parts), type);
  }
  float(n) {
    return this.literal("float", n);
  }
  int(n) {
    return this.literal("int", n);
  }
  bool(n) {
    return this.literal("bool", n);
  }
  ref(n) {
    return this.literal("ref", n);
  }
  float2(v) {
    return this.literal("float2", v);
  }
  float3(v) {
    return this.literal("float3", v);
  }
  float4(v) {
    return this.literal("float4", v);
  }
  float2x2(v) {
    return this.literal("float2x2", v);
  }
  float3x3(v) {
    return this.literal("float3x3", v);
  }
  float4x4(v) {
    return this.literal("float4x4", v);
  }
  value(value) {
    if (value?.owner !== this)
      fail("IGS_OWNER", "A socket value must belong to this graph.");
    return value;
  }
  variable(name, type, initial) {
    this.assertOpen();
    if (!signatures.includes(type))
      fail("IGS_TYPE", "Unknown variable type " + type);
    const start =
      initial === undefined
        ? Array(width[type]).fill(scalarDefault(type))
        : (this.literal(type, initial),
          Array.isArray(initial) ? initial : [initial]);
    return Object.freeze({
      owner: this,
      id: this.raw.variable(name, type, start),
      type,
      name,
    });
  }
  get(variable) {
    this.checkVariable(variable);
    return this.wrap(this.raw.get(variable.id), variable.type);
  }
  checkVariable(variable) {
    this.assertOpen();
    if (
      variable?.owner !== this ||
      !Number.isInteger(variable.id) ||
      !this.raw.graph.variables[variable.id]
    )
      fail("IGS_OWNER", "A variable must belong to this graph.");
  }
  set(variable, value) {
    this.checkVariable(variable);
    this.value(value);
    if (variable.type !== value.type)
      fail(
        "IGS_SOCKET_TYPE",
        `Variable ${variable.name} is ${variable.type}, received ${value.type}.`,
      );
    return this.node(
      "variable/set",
      { [variable.id]: value },
      { variables: [variable.id] },
    );
  }
  event(id, values = {}) {
    this.assertOpen();
    if (
      typeof id !== "string" ||
      (this.raw.graph.events ?? []).some((e) => e.id === id)
    )
      fail("IGS_EVENT", "Event IDs must be unique strings.");
    for (const type of Object.values(values))
      if (!signatures.includes(type))
        fail("IGS_TYPE", "Unknown event value type " + type);
    const index = (this.raw.graph.events ??= []).length;
    this.raw.graph.events.push({
      id,
      ...(Object.keys(values).length
        ? {
            values: Object.fromEntries(
              Object.entries(values).map(([k, t]) => [
                k,
                { type: this.raw.type(t) },
              ]),
            ),
          }
        : {}),
    });
    return Object.freeze({ owner: this, id: index, values });
  }
  receive(event) {
    if (event?.owner !== this)
      fail("IGS_OWNER", "An event must belong to this graph.");
    return this.node("event/receive", {}, { event: event.id });
  }
  send(event, values = {}) {
    if (event?.owner !== this)
      fail("IGS_OWNER", "An event must belong to this graph.");
    return this.node("event/send", values, { event: event.id });
  }
  pointer(type, path, parameters = {}) {
    return this.node("pointer/get", parameters, { pointer: path, type }).outputs
      .value;
  }
  write(type, path, value, parameters = {}) {
    return this.node(
      "pointer/set",
      { ...parameters, value },
      { pointer: path, type },
    );
  }
  node(op, inputs = {}, configuration = {}, options = {}) {
    this.assertOpen();
    const spec = catalog[op];
    if (!spec)
      fail("IGS_OPERATION", "Unknown operation " + op, {
        operation: op,
        expected: Object.keys(catalog),
      });
    const config = { ...configuration },
      groups = {},
      outputTypes = { ...options.outputTypes };
    for (const [key, val] of Object.entries(config)) {
      if (!spec.configuration[key])
        fail("IGS_CONFIGURATION", `${op} has no configuration ${key}.`, {
          operation: op,
          socket: key,
          expected: Object.keys(spec.configuration),
        });
      if (key === "type" && typeof val === "string") {
        if (!signatures.includes(val)) fail("IGS_TYPE", "Unknown type " + val);
        config[key] = this.raw.type(val);
      }
      const values = Array.isArray(config[key]) ? config[key] : [config[key]],
        kind = spec.configuration[key].type;
      if (
        (kind !== "int[]" && values.length !== 1) ||
        values.some((v) =>
          kind === "bool"
            ? typeof v !== "boolean"
            : kind === "string"
              ? typeof v !== "string"
              : typeof v !== "number" || v !== (v | 0),
        )
      )
        fail(
          "IGS_CONFIGURATION",
          `Invalid ${kind} configuration ${key} for ${op}.`,
          { operation: op, socket: key },
        );
      if (kind === "int[]" && !values.length) delete config[key];
    }
    if (op.startsWith("pointer/")) {
      if (
        typeof config.pointer !== "string" ||
        !this.raw.graph.types[config.type]
      )
        fail("IGS_REQUIRED_CONFIGURATION", `${op} requires pointer and type.`, {
          operation: op,
        });
      if (
        inputs.value &&
        inputs.value.type !== this.raw.graph.types[config.type].signature
      )
        fail("IGS_SOCKET_TYPE", `${op}.value must match the pointer type.`, {
          operation: op,
          socket: "value",
          expected: this.raw.graph.types[config.type].signature,
          actual: inputs.value.type,
        });
    }
    const expected = { ...spec.inputs };
    if (op === "variable/set")
      for (const id of config.variables ?? []) {
        const variable = this.raw.graph.variables[id];
        if (!variable) fail("IGS_VARIABLE", "Unknown variable " + id);
        expected[id] = {
          types: [this.raw.graph.types[variable.type].signature],
        };
      }
    if (op === "event/send") {
      const event = this.raw.graph.events?.[config.event];
      if (!event) fail("IGS_EVENT", "Unknown custom event " + config.event);
      for (const [name, value] of Object.entries(event.values ?? {}))
        expected[name] = {
          types: [this.raw.graph.types[value.type].signature],
        };
    }
    if (op.startsWith("pointer/"))
      for (const match of String(config.pointer ?? "").matchAll(
        /(?:^|\/)(\[([^\]]+)\]|\{([^}]+)\})(?=\/|$)/g,
      ))
        expected[match[2] ?? match[3]] = { types: [match[2] ? "int" : "ref"] };
    if (op === "math/switch")
      for (const n of config.cases ?? [])
        expected[n] = { types: spec.inputs.default.types, group: "T" };
    if (op === "debug/log")
      for (const match of String(config.message ?? "").matchAll(
        /\{([^}:]+)(?::[^}]+)?\}/g,
      ))
        expected[match[1]] = { types: signatures };
    for (const [name, value] of Object.entries(inputs)) {
      this.value(value);
      const socket = expected[name];
      if (!socket)
        fail("IGS_SOCKET", `${op} has no input value socket ${name}.`, {
          operation: op,
          socket: name,
          expected: Object.keys(expected),
        });
      if (!socket.types.includes(value.type))
        fail(
          "IGS_SOCKET_TYPE",
          `${op}.${name} needs ${socket.types.join(" | ")}, received ${value.type}.`,
          {
            operation: op,
            socket: name,
            expected: socket.types,
            actual: value.type,
          },
        );
      if (socket.group) {
        if (groups[socket.group] && groups[socket.group] !== value.type)
          fail(
            "IGS_TYPE_GROUP",
            `${op} inputs in group ${socket.group} must have the same type.`,
            {
              operation: op,
              socket: name,
              expected: groups[socket.group],
              actual: value.type,
            },
          );
        groups[socket.group] = value.type;
      }
    }
    if (op === "math/transform" && inputs.a && inputs.b) {
      const matrix = {
        float2: "float2x2",
        float3: "float3x3",
        float4: "float4x4",
      }[inputs.a.type];
      if (inputs.b.type !== matrix)
        fail(
          "IGS_TYPE_RELATION",
          `math/transform ${inputs.a.type} requires ${matrix}.`,
          {
            operation: op,
            socket: "b",
            expected: matrix,
            actual: inputs.b.type,
          },
        );
    }
    for (const name of Object.keys(expected))
      if (!Object.hasOwn(inputs, name))
        fail("IGS_REQUIRED_SOCKET", `${op} requires input ${name}.`, {
          operation: op,
          socket: name,
          expected: expected[name].types,
        });
    for (const [name, s] of Object.entries(spec.outputs)) {
      const inferred = s.group
        ? groups[s.group]
        : s.types.length === 1
          ? s.types[0]
          : undefined;
      if (
        outputTypes[name] &&
        (!s.types.includes(outputTypes[name]) ||
          (inferred && inferred !== outputTypes[name]))
      )
        fail("IGS_OUTPUT_TYPE", `Invalid output type for ${op}.${name}.`, {
          operation: op,
          socket: name,
          expected: inferred ?? s.types,
          actual: outputTypes[name],
        });
      outputTypes[name] ??= inferred;
    }
    if (op === "pointer/get") {
      const type = this.raw.graph.types[config.type]?.signature;
      if (!type) fail("IGS_TYPE", "pointer/get requires a type configuration.");
      outputTypes.value = type;
    }
    if (op === "variable/get") {
      const v = this.raw.graph.variables[config.variable];
      if (!v) fail("IGS_VARIABLE", "Unknown variable " + config.variable);
      outputTypes.value = this.raw.graph.types[v.type].signature;
    }
    if (op === "event/receive") {
      const event = this.raw.graph.events?.[config.event];
      if (!event) fail("IGS_EVENT", "Unknown custom event " + config.event);
      for (const [name, s] of Object.entries(event.values ?? {}))
        outputTypes[name] = this.raw.graph.types[s.type].signature;
    }
    if (op === "math/switch") outputTypes.value = inputs.default.type;
    for (const [name, type] of Object.entries(outputTypes))
      if (!type || !signatures.includes(type))
        fail(
          "IGS_OUTPUT_TYPE",
          `Cannot resolve ${op}.${name}; supply outputTypes.`,
          { operation: op, socket: name },
        );
    const id = this.raw.node(
        op,
        Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.edge])),
        config,
        spec.extension,
        Object.fromEntries(Object.entries(outputTypes).map(([id, type]) => [id, this.raw.type(type)])),
      ),
      outputs = Object.fromEntries(
        Object.entries(outputTypes).map(([name, type]) => [
          name,
          this.wrap(this.raw.output(id, type, name), type),
        ]),
      );
    const handle = {
      owner: this,
      id,
      op,
      label: options.label,
      outputs,
      flow: (socket = "out") => ({
        to: (target, input = "in") => {
          this.connect(handle, socket, target, input);
          return target;
        },
      }),
    };
    if (options.label)
      this.raw.graph.nodes[id].extras = { label: options.label };
    this.handles.push(handle);
    return handle;
  }
  connect(from, output, to, input = "in") {
    this.assertOpen();
    if (from?.owner !== this || to?.owner !== this)
      fail("IGS_OWNER", "Flow connections must belong to this graph.");
    const source = catalog[from.op],
      target = catalog[to.op];
    const configuration = this.raw.graph.nodes[from.id].configuration;
    const dynamicOutput =
      from.op === "flow/switch"
        ? (configuration?.cases?.value ?? []).map(String).includes(output)
        : ["flow/sequence", "flow/multiGate"].includes(from.op);
    if (!source.flowOutputs.includes(output) && !dynamicOutput)
      fail("IGS_FLOW_SOCKET", `${from.op} has no flow output ${output}.`, {
        operation: from.op,
        socket: output,
        expected: source.flowOutputs,
      });
    if (
      !target.flowInputs.includes(input) &&
      !(
        to.op === "flow/waitAll" &&
        /^\d+$/.test(input) &&
        Number(input) <
          (this.raw.graph.nodes[to.id].configuration?.inputFlows?.value[0] ?? 0)
      )
    )
      fail("IGS_FLOW_SOCKET", `${to.op} has no flow input ${input}.`, {
        operation: to.op,
        socket: input,
        expected: target.flowInputs,
      });
    const node = this.raw.graph.nodes[from.id];
    if (node.flows?.[output])
      fail(
        "IGS_FLOW_CONNECTED",
        `${from.op}.${output} already has a target. Use flow/sequence to fan out.`,
      );
    (node.flows ??= {})[output] = { node: to.id, socket: input };
    return to;
  }
  sequence(...actions) {
    const node = this.node("flow/sequence");
    actions.forEach((action, j) =>
      this.connect(node, String(j).padStart(6, "0"), action),
    );
    return node;
  }
  finish() {
    this.assertOpen();
    if (this.optimize) {
      this.raw.fuseVariableWrites();
      this.raw.compactSequences();
    }
    const mapping = this.raw.orderFlows();
    for (const h of this.handles) h.id = mapping[h.id];
    for (const edge of this.edges)
      if (edge.node !== undefined) edge.node = mapping[edge.node];
    for (const key of ["variables", "events"])
      if (this.raw.graph[key]?.length === 0) delete this.raw.graph[key];
    validateInteractivityGraph(this.raw.graph);
    this.closed = true;
    return this.raw.graph;
  }
}
export const defineGraph = (author) => author;
