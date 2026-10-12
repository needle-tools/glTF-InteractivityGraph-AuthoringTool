import { catalog } from "../catalog.mjs";
// Small typed builder shared by the compiler and visual conformance assets.
export class Graph {
  constructor(name) {
    this.graph = {
      name,
      types: [
        "bool",
        "int",
        "float",
        "float2",
        "float3",
        "float4",
        "float2x2",
        "float3x3",
        "float4x4",
        "ref",
      ].map((signature) => ({ signature })),
      variables: [],
      declarations: [],
      nodes: [],
    };
    this.declarations = new Map();
    this.dataNodes = new Map();
  }
  compactSequences() {
    // Single-output sequences only forward control; bypass them after linking.
    const forwards = new Map(
      this.graph.nodes.flatMap((n, id) =>
        this.graph.declarations[n.declaration].op === "flow/sequence" &&
        !n.extras?.cooperativeEntry &&
        Object.keys(n.flows ?? {}).length === 1
          ? [[id, Object.values(n.flows)[0]]]
          : [],
      ),
    );
    const resolve = (edge) => {
      const seen = new Set();
      while (forwards.has(edge.node) && !seen.has(edge.node)) {
        seen.add(edge.node);
        edge = forwards.get(edge.node);
      }
      return edge;
    };
    for (const node of this.graph.nodes)
      if (node.flows)
        node.flows = Object.fromEntries(
          Object.entries(node.flows).map(([name, edge]) => [
            name,
            resolve(edge),
          ]),
        );
  }
  fuseVariableWrites() {
    // Compose straight-line assignments into one simultaneous write. Substitute
    // earlier RHS expressions so every input still observes source-order state.
    const nodes = this.graph.nodes,
      op = (n) => this.graph.declarations[n.declaration].op;
    const incoming = nodes.map(() => 0);
    for (const n of nodes)
      for (const e of Object.values(n.flows ?? {})) incoming[e.node]++;
    const volatileCache = new Map();
    const volatile = (value) => {
      if (value.node === undefined) return false;
      if (volatileCache.has(value.node)) return volatileCache.get(value.node);
      const n = nodes[value.node],
        operation = op(n);
      const result =
        operation === "math/random" ||
        Boolean(this.graph.declarations[n.declaration].extension) ||
        Object.values(n.values ?? {}).some(volatile);
      volatileCache.set(value.node, result);
      return result;
    };
    const absorbed = new Set();
    for (let id = 0; id < nodes.length; id++) {
      const first = nodes[id];
      if (
        absorbed.has(id) ||
        op(first) !== "variable/set" ||
        Object.values(first.values).some(volatile)
      )
        continue;
      let current = first,
        definitions = { ...first.values };
      for (let step = 0; step < 16; step++) {
        const edge = current.flows?.out;
        if (
          !edge ||
          Object.keys(current.flows).length !== 1 ||
          incoming[edge.node] !== 1
        )
          break;
        const next = nodes[edge.node];
        if (
          op(next) !== "variable/set" ||
          absorbed.has(edge.node) ||
          Object.values(next.values).some(volatile)
        )
          break;
        const cache = new Map();
        const substitute = (value) => {
          if (value.node === undefined) return value;
          const source = nodes[value.node],
            operation = op(source);
          if (operation === "variable/get")
            return definitions[source.configuration.variable.value[0]] ?? value;
          if (cache.has(value.node + ":" + value.socket))
            return cache.get(value.node + ":" + value.socket);
          const inputs = Object.fromEntries(
            Object.entries(source.values ?? {}).map(([k, v]) => [
              k,
              substitute(v),
            ]),
          );
          if (Object.entries(inputs).every(([k, v]) => v === source.values[k]))
            return value;
          const signature = this.graph.types[value.type].signature,
            config = Object.fromEntries(
              Object.entries(source.configuration ?? {}).map(([k, v]) => [
                k,
                v.value,
              ]),
            );
          const rewritten = this.data(
            operation,
            signature,
            inputs,
            config,
            value.socket,
          );
          cache.set(value.node + ":" + value.socket, rewritten);
          return rewritten;
        };
        const updates = Object.fromEntries(
          Object.entries(next.values).map(([k, v]) => [k, substitute(v)]),
        );
        definitions = { ...definitions, ...updates };
        absorbed.add(edge.node);
        current = next;
      }
      first.values = definitions;
      first.configuration = {
        variables: { value: Object.keys(definitions).map(Number) },
      };
      if (current.flows) first.flows = current.flows;
      else delete first.flows;
    }
  }
  eliminateDeadStores(keep) {
    const reads = new Set(keep);
    for (const node of this.graph.nodes)
      if (this.graph.declarations[node.declaration].op === "variable/get")
        reads.add(node.configuration.variable.value[0]);
    let changed = false;
    for (const node of this.graph.nodes)
      if (this.graph.declarations[node.declaration].op === "variable/set") {
        const values = Object.fromEntries(
          Object.entries(node.values).filter(([key]) => reads.has(Number(key))),
        );
        if (Object.keys(values).length === Object.keys(node.values).length)
          continue;
        changed = true;
        if (Object.keys(values).length) {
          node.values = values;
          node.configuration.variables.value = Object.keys(values).map(Number);
        } else {
          delete node.values;
          delete node.configuration;
          const key = "flow/sequence";
          if (!this.declarations.has(key)) {
            this.declarations.set(key, this.graph.declarations.length);
            this.graph.declarations.push({ op: key });
          }
          node.declaration = this.declarations.get(key);
        }
      }
    return changed;
  }
  pruneVariables(keep) {
    const used = new Set(keep);
    for (const node of this.graph.nodes) {
      const op = this.graph.declarations[node.declaration].op;
      if (op === "variable/get") used.add(node.configuration.variable.value[0]);
      if (op === "variable/set")
        for (const key of Object.keys(node.values)) used.add(Number(key));
    }
    const ids = new Map(
      [...used].sort((a, b) => a - b).map((old, id) => [old, id]),
    );
    this.graph.variables = this.graph.variables.filter((_, id) => used.has(id));
    for (const node of this.graph.nodes) {
      const op = this.graph.declarations[node.declaration].op;
      if (op === "variable/get")
        node.configuration.variable.value[0] = ids.get(
          node.configuration.variable.value[0],
        );
      if (op === "variable/set") {
        node.values = Object.fromEntries(
          Object.entries(node.values).map(([key, v]) => [
            ids.get(Number(key)),
            v,
          ]),
        );
        node.configuration.variables.value = Object.keys(node.values).map(
          Number,
        );
      }
    }
    return ids;
  }
  pruneNodes() {
    const nodes = this.graph.nodes,
      used = new Set();
    const visit = (start) => {
      const pending = [start];
      while (pending.length) {
        const id = pending.pop();
        if (used.has(id)) continue;
        used.add(id);
        const n = nodes[id];
        for (const edge of Object.values(n.flows ?? {}))
          pending.push(edge.node);
        for (const edge of Object.values(n.values ?? {}))
          if (edge.node !== undefined) pending.push(edge.node);
      }
    };
    nodes.forEach((n, id) => {
      if (this.graph.declarations[n.declaration].op.startsWith("event/"))
        visit(id);
    });
    const ids = new Map(
      [...used].sort((a, b) => a - b).map((old, id) => [old, id]),
    );
    this.graph.nodes = nodes.filter((_, id) => used.has(id));
    for (const n of this.graph.nodes)
      for (const key of ["values", "flows"])
        if (n[key])
          n[key] = Object.fromEntries(
            Object.entries(n[key]).map(([k, v]) => [
              k,
              v.node === undefined ? v : { ...v, node: ids.get(v.node) },
            ]),
          );
    this.dataNodes.clear();
    return ids;
  }
  pruneTypes() {
    const used = new Set();
    for (const d of this.graph.declarations)
      for (const key of ["inputValueSockets", "outputValueSockets"])
        for (const socket of Object.values(d[key] ?? {})) used.add(socket.type);
    for (const variable of this.graph.variables) used.add(variable.type);
    for (const event of this.graph.events ?? [])
      for (const value of Object.values(event.values ?? {}))
        used.add(value.type);
    for (const node of this.graph.nodes) {
      for (const value of Object.values(node.values ?? {}))
        if (value.type !== undefined) used.add(value.type);
      if (node.configuration?.type) used.add(node.configuration.type.value[0]);
    }
    if (
      this.graph.declarations.some((d) => /event\/on(Select|Hover)/.test(d.op))
    )
      used.add(this.type("ref"));
    const mapping = new Map(
      [...used].sort((a, b) => a - b).map((id, j) => [id, j]),
    );
    for (const d of this.graph.declarations)
      for (const key of ["inputValueSockets", "outputValueSockets"])
        for (const socket of Object.values(d[key] ?? {}))
          socket.type = mapping.get(socket.type);
    for (const variable of this.graph.variables)
      variable.type = mapping.get(variable.type);
    for (const event of this.graph.events ?? [])
      for (const value of Object.values(event.values ?? {}))
        value.type = mapping.get(value.type);
    for (const node of this.graph.nodes) {
      if (node.values)
        node.values = Object.fromEntries(
          Object.entries(node.values).map(([name, value]) => [
            name,
            value.type === undefined
              ? value
              : { ...value, type: mapping.get(value.type) },
          ]),
        );
      if (node.configuration?.type)
        node.configuration.type = {
          value: [mapping.get(node.configuration.type.value[0])],
        };
    }
    this.graph.types = this.graph.types.filter((_, id) => used.has(id));
  }
  orderFlows() {
    const nodes = this.graph.nodes,
      indegree = nodes.map(() => 0),
      successors = nodes.map(() => new Set());
    nodes.forEach((node, id) => {
      for (const edge of Object.values(node.flows ?? {}))
        successors[id].add(edge.node);
      for (const source of Object.values(node.values ?? {}))
        if (source.node !== undefined) successors[source.node].add(id);
    });
    successors.forEach((next) => next.forEach((id) => indegree[id]++));
    const ready = indegree.flatMap((count, id) => (count === 0 ? [id] : [])),
      order = [];
    for (let cursor = 0; cursor < ready.length; cursor++) {
      const id = ready[cursor];
      order.push(id);
      for (const next of successors[id])
        if (--indegree[next] === 0) ready.push(next);
    }
    if (order.length !== nodes.length)
      throw new Error("Flow or value cycle in compiled graph");
    const mapping = Object.fromEntries(order.map((old, id) => [old, id]));
    nodes.forEach((node) => {
      for (const key of ["flows", "values"])
        if (node[key])
          node[key] = Object.fromEntries(
            Object.entries(node[key]).map(([socket, edge]) => [
              socket,
              edge.node === undefined
                ? edge
                : { ...edge, node: mapping[edge.node] },
            ]),
          );
    });
    this.graph.nodes = order.map((id) => nodes[id]);
    this.dataNodes.clear();
    return mapping;
  }
  literal(type, value) {
    return {
      type: this.type(type),
      value: Array.isArray(value) ? value : [value],
    };
  }
  type(name) {
    return this.graph.types.findIndex((t) => t.signature === name);
  }
  node(op, values = {}, configuration = {}, extension) {
    const key = op + (extension ?? "");
    if (!this.declarations.has(key)) {
      this.declarations.set(key, this.graph.declarations.length);
      const declaration = { op, ...(extension ? { extension } : {}) };
      if (extension && catalog[op])
        for (const [source, target] of [
          ["inputs", "inputValueSockets"],
          ["outputs", "outputValueSockets"],
        ]) {
          const sockets = catalog[op][source];
          if (Object.keys(sockets).length)
            declaration[target] = Object.fromEntries(
              Object.entries(sockets).map(([name, socket]) => [
                name,
                { type: this.type(socket.types[0]) },
              ]),
            );
        }
      this.graph.declarations.push(declaration);
    }
    const node = { declaration: this.declarations.get(key) };
    if (Object.keys(values).length) node.values = values;
    if (Object.keys(configuration).length)
      node.configuration = Object.fromEntries(
        Object.entries(configuration).map(([k, v]) => [
          k,
          { value: Array.isArray(v) ? v : [v] },
        ]),
      );
    this.graph.nodes.push(node);
    return this.graph.nodes.length - 1;
  }
  output(node, type, socket = "value") {
    return { node, socket, type: this.type(type) };
  }
  data(op, type, values = {}, configuration = {}, socket = "value") {
    const key = JSON.stringify([op, type, values, configuration, socket]);
    if (!this.dataNodes.has(key))
      this.dataNodes.set(
        key,
        this.output(this.node(op, values, configuration), type, socket),
      );
    return this.dataNodes.get(key);
  }
  math(op, type, ...args) {
    return this.data(
      "math/" + op,
      type,
      Object.fromEntries(args.map((a, i) => [String.fromCharCode(97 + i), a])),
    );
  }
  select(condition, whenFalse, whenTrue, type) {
    return this.data("math/select", type, {
      condition,
      a: whenTrue,
      b: whenFalse,
    });
  }
  variable(name, type, value) {
    const id = this.graph.variables.length;
    this.graph.variables.push({
      name,
      type: this.type(type),
      value: Array.isArray(value) ? value : [value],
    });
    return id;
  }
  get(id) {
    return this.data(
      "variable/get",
      this.graph.types[this.graph.variables[id].type].signature,
      {},
      { variable: id },
    );
  }
  set(values) {
    return this.node(
      "variable/set",
      Object.fromEntries(Object.entries(values)),
      { variables: Object.keys(values).map(Number) },
    );
  }
  pointer(path, type, values = {}) {
    return this.data("pointer/get", type, values, {
      pointer: path,
      type: this.type(type),
    });
  }
  write(path, type, value, values = {}) {
    return this.node(
      "pointer/set",
      { ...values, value },
      { pointer: path, type: this.type(type) },
    );
  }
  link(from, to, socket = "out") {
    if (to !== undefined)
      (this.graph.nodes[from].flows ??= {})[socket] = {
        node: to,
        socket: "in",
      };
    return to;
  }
  chain(...nodes) {
    nodes.forEach((n, i) => this.link(n, nodes[i + 1]));
    return nodes[0];
  }
  extract(a, type, index) {
    return this.data(
      "math/extract" + type.slice(5),
      "float",
      { a },
      {},
      String(index),
    );
  }
  vec3(a, b, c) {
    return this.data("math/combine3", "float3", { a, b, c });
  }
  vec4(a, b, c, d) {
    return this.data("math/combine4", "float4", { a, b, c, d });
  }
  convert(a, from, to) {
    return from === to
      ? a
      : this.data(
          "type/" + from + "To" + to[0].toUpperCase() + to.slice(1),
          to,
          { a },
        );
  }
}
