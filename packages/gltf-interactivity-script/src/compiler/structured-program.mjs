import { sliceGraph } from "./cooperative.mjs";
import { lowerStructured } from "./structured.mjs";

// Generic event loop: execute the JS callback to completion, then the next job.
// Pointer hover callbacks can explicitly coalesce; reset can explicitly interrupt.
export function lowerStructuredProgram(program, options = {}) {
  const k = lowerStructured(program, options),
    g = k.g;
  if (!program.bindings.length) {
    g.graph.variables[k.vars.pc].value = [1];
    const event = g.node("event/onStart");
    const root = k.track(k.prepare(options.entry ?? "main"));
    g.link(event, root.node);
    const resume = options.cooperative
      ? k.track(g.node("flow/sequence"))
      : undefined;
    if (resume) g.link(g.node("event/onTick"), resume.node);
    k.finish();
    if (resume) sliceGraph(k, [root.node], resume.node, options.cooperative);
    return k;
  }
  const f = (n) => g.literal("float", n),
    i = (n) => g.literal("int", n),
    bool = (n) => g.literal("bool", n);
  const asFloat = (v, type) =>
      type === "float" ? v : g.convert(v, type, "float"),
    asInt = (v) => g.convert(v, "float", "int");
  const cooperativeRoots = new Set();
  const bindings = program.bindings,
    maxArgs = Math.max(
      1,
      ...bindings.map((b) =>
        ["Tick", "Frame"].includes(b.kind)
          ? program.functions[b.handler].params.length
          : b.args.length,
      ),
    );
  const capacity = 32,
    stride = maxArgs + 1,
    queueBase = k.initial.length;
  k.initial.push(...Array(capacity * stride).fill(0));
  k.memorySize = k.initial.length;
  const head = g.variable("event queue head", "int", 0),
    tail = g.variable("event queue tail", "int", 0),
    count = g.variable("event queue count", "int", 0);
  const current = g.variable("current event", "int", 0),
    args = Array.from({ length: maxArgs }, (_, j) =>
      g.variable("event argument " + j, "float", 0),
    );
  const groups = new Map();
  for (const binding of bindings)
    if (binding.options.coalesce && !groups.has(binding.options.coalesce))
      groups.set(binding.options.coalesce, {
        pending: g.variable(
          "pending " + binding.options.coalesce,
          "bool",
          false,
        ),
        id: g.variable("latest " + binding.options.coalesce, "int", 0),
        args: Array.from({ length: maxArgs }, (_, j) =>
          g.variable(binding.options.coalesce + " argument " + j, "float", 0),
        ),
      });
  const memoryAt = (slot, offset) =>
    g.math(
      "add",
      "int",
      i(queueBase + offset),
      g.math("mul", "int", g.get(slot), i(stride)),
    );
  function launch(binding, values, execute = false) {
    const call = k.prepare(
      binding.handler,
      values,
      binding.options.immediate || binding.kind === "Frame"
        ? "immediate:" + binding.handler
        : "",
    );
    if (!(binding.options.immediate || binding.kind === "Frame"))
      cooperativeRoots.add(call);
    if (!binding.options.interrupt) return call;
    const writes = { [head]: i(0), [tail]: i(0), [count]: i(0) };
    for (const group of groups.values()) writes[group.pending] = bool(false);
    const clear = g.set(writes);
    g.link(clear, call);
    return clear;
  }

  function dispatch(ids, selection, values) {
    if (!ids.length) return undefined;
    const node = g.node("flow/switch", { selection }, { cases: ids });
    for (const id of ids)
      g.link(node, launch(bindings[id], values, true), String(id));
    const fault = g.set({ [k.vars.fault]: bool(true), [k.vars.pc]: i(-1) });
    g.link(node, fault, "default");
    return node;
  }
  function enqueue(id, values) {
    const binding = bindings[id];
    if (binding.options.interrupt || binding.options.immediate)
      return launch(binding, values);
    if (binding.options.coalesce) {
      const group = groups.get(binding.options.coalesce);
      return g.set({
        [group.pending]: bool(true),
        [group.id]: i(id),
        ...Object.fromEntries(
          group.args.map((arg, j) => [arg, values[j] ?? f(0)]),
        ),
      });
    }
    const gate = g.node("flow/branch", {
      condition: g.math("lt", "bool", g.get(count), i(capacity)),
    });
    const overflow = g.set({ [k.vars.fault]: bool(true), [k.vars.pc]: i(-1) });
    g.link(gate, overflow, "false");
    const writes = [
      k.writeMemory(memoryAt(tail, 0), f(id)),
      ...args.map((_, j) =>
        k.writeMemory(memoryAt(tail, j + 1), values[j] ?? f(0)),
      ),
      g.set({
        [tail]: g.math(
          "rem",
          "int",
          g.math("add", "int", g.get(tail), i(1)),
          i(capacity),
        ),
        [count]: g.math("add", "int", g.get(count), i(1)),
      }),
    ];
    g.chain(...writes);
    g.link(gate, writes[0], "true");
    return gate;
  }
  g.graph.events ??= [];
  bindings.forEach((binding, id) => {
    let node, values;
    if (["Start", "Tick", "Frame"].includes(binding.kind)) return;
    if (binding.kind === "Receive") {
      if (g.graph.events.some((e) => e.id === binding.target))
        throw new Error("Duplicate custom event " + binding.target);
      const event = g.graph.events.length,
        params = program.functions[binding.handler].params;
      g.graph.events.push({
        id: binding.target,
        ...(params.length
          ? {
              values: Object.fromEntries(
                params.map((name, j) => [
                  name,
                  { type: g.type(binding.args[j]) },
                ]),
              ),
            }
          : {}),
      });
      node = g.node("event/receive", {}, { event });
      values = params.map((name, j) =>
        asFloat(g.output(node, binding.args[j], name), binding.args[j]),
      );
    } else {
      const select = binding.kind === "Select",
        extension = select ? "KHR_node_selectability" : "KHR_node_hoverability";
      node = g.node(
        "event/on" + binding.kind,
        {},
        { nodeIndex: binding.target },
        extension,
      );
      values = binding.args.map(f);
    }
    g.link(node, enqueue(id, values));
  });
  const tick = g.node("event/onTick"),
    choose = g.node("flow/branch", {
      condition: g.math("gt", "bool", g.get(count), i(0)),
    });
  const resume = options.cooperative
    ? k.track(g.node("flow/sequence"))
    : undefined;
  const busy = options.cooperative
    ? g.node("flow/branch", {
        condition: g.math("ge", "bool", g.get(k.vars.pc), i(0)),
      })
    : undefined;
  if (busy !== undefined) {
    g.link(busy, resume.node, "true");
    g.link(busy, choose, "false");
  }
  const frameBinding = bindings.find((b) => b.kind === "Frame");
  const tickValues = (binding) =>
    [
      g.output(tick, "float", "timeSinceStart"),
      g.output(tick, "float", "timeSinceLastTick"),
    ].slice(0, program.functions[binding.handler].params.length);
  if (frameBinding) {
    const frame = g.node("flow/sequence");
    g.link(tick, frame);
    g.link(frame, launch(frameBinding, tickValues(frameBinding)), "0");
    g.link(frame, busy ?? choose, "1");
  } else g.link(tick, busy ?? choose);
  const load = g.set({
    [current]: asInt(k.memory(memoryAt(head, 0))),
    ...Object.fromEntries(
      args.map((arg, j) => [arg, k.memory(memoryAt(head, j + 1))]),
    ),
  });
  g.link(choose, load, "true");
  const pop = g.set({
    [head]: g.math(
      "rem",
      "int",
      g.math("add", "int", g.get(head), i(1)),
      i(capacity),
    ),
    [count]: g.math("sub", "int", g.get(count), i(1)),
  });
  g.link(load, pop);
  const queued = bindings.flatMap((b, id) =>
    !["Start", "Tick", "Frame"].includes(b.kind) &&
    !b.options.coalesce &&
    !b.options.interrupt &&
    !b.options.immediate
      ? [id]
      : [],
  );
  g.link(
    pop,
    dispatch(
      queued,
      g.get(current),
      args.map((arg) => g.get(arg)),
    ),
  );
  let previous = choose;
  for (const [name, group] of groups) {
    const check = g.node("flow/branch", { condition: g.get(group.pending) });
    g.link(previous, check, "false");
    previous = check;
    const clear = g.set({ [group.pending]: bool(false) });
    g.link(check, clear, "true");
    const ids = bindings.flatMap((b, id) =>
      b.options.coalesce === name ? [id] : [],
    );
    g.link(
      clear,
      dispatch(
        ids,
        g.get(group.id),
        group.args.map((arg) => g.get(arg)),
      ),
    );
  }
  const tickBinding = bindings.find((b) => b.kind === "Tick");
  g.link(
    previous,
    tickBinding
      ? launch(tickBinding, tickValues(tickBinding), true)
      : undefined,
    "false",
  );
  const start = bindings.find((b) => b.kind === "Start");
  if (start) {
    const event = g.node("event/onStart");
    g.link(event, launch(start, []));
  }
  if (!g.graph.events.length) delete g.graph.events;
  k.eventQueue = { head, tail, count, capacity };
  // Track callback roots through the normal optimizer before slicing their control graph.
  const roots = [...cooperativeRoots].map((node) => k.track(node));
  k.finish();
  if (options.cooperative)
    sliceGraph(
      k,
      roots.map((anchor) => anchor.node),
      resume.node,
      options.cooperative,
    );
  return k;
}
