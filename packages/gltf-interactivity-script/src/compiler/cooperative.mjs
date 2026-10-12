// Convert optimized synchronous callback control into resumable graph states.
// Expressions and activation locals stay in the structured compiler's graph.
// Only the control stack is explicit; no JavaScript runs in the asset player.
export function sliceGraph(
  k,
  roots,
  resume,
  { stepsPerTick = 64, stackCapacity = 512 } = {},
) {
  for (const n of [stepsPerTick, stackCapacity])
    if (!Number.isSafeInteger(n) || n < 1)
      throw new Error("Invalid cooperative capacity");
  if (!roots.length) return;
  const g = k.g,
    nodes = g.graph.nodes;
  g.graph.events ??= [];
  const op = (n) => g.graph.declarations[n.declaration].op;
  const initialControl = new Set();
  function discover(id) {
    if (id === undefined || initialControl.has(id)) return;
    initialControl.add(id);
    for (const edge of Object.values(nodes[id].flows ?? {}))
      discover(edge.node);
  }
  roots.forEach(discover);
  for (const id of initialControl)
    if (op(nodes[id]) === "flow/for") {
      const n = nodes[id],
        index = g.variable("cooperative for index " + id, "int", 0),
        getter = g.get(index);
      for (const consumer of nodes)
        for (const [key, value] of Object.entries(consumer.values ?? {}))
          if (value.node === id && value.socket === "index")
            consumer.values[key] = { ...getter };
      const loop = g.node("flow/while", {
        condition: g.math("lt", "bool", getter, n.values.endIndex),
      });
      const body = g.node("flow/sequence");
      if (n.flows?.loopBody) g.link(body, n.flows.loopBody.node, "0");
      g.link(
        body,
        g.set({ [index]: g.math("add", "int", getter, g.literal("int", 1)) }),
        "1",
      );
      g.link(loop, body, "loopBody");
      if (n.flows?.completed) g.link(loop, n.flows.completed.node, "completed");
      const start = g.set({ [index]: n.values.startIndex });
      n.declaration = nodes[start].declaration;
      n.values = nodes[start].values;
      n.configuration = nodes[start].configuration;
      n.flows = { out: { node: loop, socket: "in" } };
    }
  // Normalize sequences into pairs so each call has one continuation.
  const originalCount = nodes.length;
  for (let id = 0; id < originalCount; id++)
    if (op(nodes[id]) === "flow/sequence") {
      const children = Object.keys(nodes[id].flows ?? {})
        .sort()
        .map((key) => nodes[id].flows[key]);
      if (children.length > 2) {
        let tail = children.at(-1);
        for (let j = children.length - 2; j > 0; j--) {
          const node = g.node("flow/sequence");
          nodes[node].flows = { 0: children[j], 1: tail };
          tail = { node, socket: "in" };
        }
        nodes[id].flows = { 0: children[0], 1: tail };
      }
    }
  const original = nodes.map((n) => ({ ...n, flows: { ...n.flows } }));
  const control = new Set();
  function visit(id) {
    if (id === undefined || control.has(id)) return;
    control.add(id);
    for (const edge of Object.values(original[id].flows)) visit(edge.node);
  }
  roots.forEach(visit);
  // Infer implicit return destinations. Private regions return directly;
  // only shared call sites need the dynamic continuation stack.
  const owners = new Map(),
    pending = roots.map((id) => [id, -1]);
  while (pending.length) {
    const [id, ret] = pending.pop();
    if (id === undefined) continue;
    let set = owners.get(id);
    if (!set) owners.set(id, (set = new Set()));
    if (set.has(ret)) continue;
    set.add(ret);
    const n = original[id],
      operation = op(n);
    if (operation === "flow/sequence") {
      const children = Object.keys(n.flows)
        .sort()
        .map((key) => n.flows[key].node);
      for (let j = 0; j < children.length; j++)
        pending.push([children[j], children[j + 1] ?? ret]);
    } else
      for (const [key, edge] of Object.entries(n.flows))
        pending.push([
          edge.node,
          operation === "flow/while" && key === "loopBody" ? id : ret,
        ]);
  }
  const dynamicReturn = new Map();
  function needsStack(root, seen = new Set()) {
    if (root === undefined || seen.has(root)) return false;
    if (dynamicReturn.has(root)) return dynamicReturn.get(root);
    seen.add(root);
    const n = original[root],
      operation = op(n);
    let dynamic = owners.get(root)?.size > 1;
    if (!dynamic) {
      const edges =
        operation === "flow/sequence"
          ? Object.keys(n.flows)
              .sort()
              .slice(-1)
              .map((key) => n.flows[key])
          : operation === "flow/while"
            ? [n.flows.completed].filter(Boolean)
            : Object.values(n.flows);
      dynamic = edges.some((edge) => needsStack(edge.node, seen));
    }
    dynamicReturn.set(root, dynamic);
    return dynamic;
  }
  // Keep short innermost loops native. Their acyclic bodies cannot suspend;
  // bounded batches avoid a stack push/pop and dispatch for every iteration.
  const batched = new Map();
  function boundedBody(root) {
    const seen = new Set(),
      active = new Set();
    function walk(id) {
      if (active.has(id)) return false;
      if (id === undefined || seen.has(id)) return true;
      seen.add(id);
      if (seen.size > 64 || op(original[id]) === "flow/while") return false;
      active.add(id);
      const safe = Object.values(original[id].flows).every((edge) =>
        walk(edge.node),
      );
      active.delete(id);
      return safe;
    }
    return walk(root) ? seen : undefined;
  }
  for (const id of control)
    if (op(original[id]) === "flow/while") {
      const body = boundedBody(original[id].flows.loopBody?.node);
      if (body?.size) batched.set(id, body);
    }
  const effective = new Set();
  function live(id) {
    if (id === undefined || effective.has(id)) return;
    effective.add(id);
    for (const [socket, edge] of Object.entries(original[id].flows))
      if (!(batched.has(id) && socket === "loopBody")) live(edge.node);
  }
  roots.forEach(live);
  // Yield only where structured control returns: loop iterations and calls.
  // Ordinary arithmetic, branches and writes keep their native flow links.
  const continuations = new Set(roots);
  for (const id of effective) {
    const n = original[id];
    if (op(n) === "flow/sequence")
      Object.keys(n.flows)
        .sort()
        .slice(1)
        .forEach((key) => continuations.add(n.flows[key].node));
    if (op(n) === "flow/while") continuations.add(id);
  }
  const callTargets = new Set(
    [...k.instances.values()]
      .map((fn) => fn.entry)
      .filter((id) => effective.has(id)),
  );
  for (const id of callTargets) continuations.add(id);
  const ids = [...continuations],
    states = new Map(ids.map((id, j) => [id, j]));
  const i = (n) => g.literal("int", n),
    f = (n) => g.literal("float", n);
  const state = g.variable("cooperative continuation", "int", -1);
  const sp = g.variable("cooperative stack depth", "int", 0);
  const limit = g.variable("cooperative steps per tick", "int", stepsPerTick);
  const used = g.variable("cooperative steps executed", "int", 0);
  const slices = g.variable("cooperative slices", "int", 0);
  const workStart = g.variable("cooperative quantum start", "int", 0);
  const stackBase = k.initial.length;
  k.initial.push(...Array(stackCapacity).fill(0));
  k.memorySize = k.initial.length;
  const fault = g.set({
    [k.vars.fault]: g.literal("bool", true),
    [state]: i(-1),
    [k.vars.pc]: i(-1),
  });
  const pop = g.node("flow/branch", {
    condition: g.math("gt", "bool", g.get(sp), i(0)),
  });
  const decrement = g.set({ [sp]: g.math("sub", "int", g.get(sp), i(1)) });
  g.link(pop, decrement, "true");
  g.link(
    decrement,
    g.set({
      [state]: g.convert(
        k.memory(g.math("add", "int", i(stackBase), g.get(sp))),
        "float",
        "int",
      ),
    }),
  );
  g.link(pop, g.set({ [state]: i(-1) }), "false");
  const calls = new Map(
    [...callTargets].map((id) => [id, g.set({ [state]: i(states.get(id)) })]),
  );
  const entry = (id) => calls.get(id) ?? id;
  const ended = new Map();
  function end(id) {
    if (ended.has(id)) return ended.get(id);
    const returns = owners.get(id);
    let target = pop;
    if (returns?.size === 1) {
      const ret = [...returns][0];
      target =
        ret < 0
          ? g.set({ [state]: i(-1) })
          : op(original[ret]) === "flow/while"
            ? g.set({ [state]: i(states.get(ret)) })
            : entry(ret);
    }
    ended.set(id, target);
    return target;
  }
  const next = (edge, id) => (edge ? entry(edge.node) : end(id));
  function push(continuations, target) {
    const gate = g.node("flow/branch", {
      condition: g.math(
        "le",
        "bool",
        g.math("add", "int", g.get(sp), i(continuations.length)),
        i(stackCapacity),
      ),
    });
    g.link(gate, fault, "false");
    const writes = continuations.map((id, offset) =>
      k.writeMemory(
        g.math("add", "int", i(stackBase + offset), g.get(sp)),
        f(states.get(id)),
      ),
    );
    writes.push(
      g.set({
        [sp]: g.math("add", "int", g.get(sp), i(continuations.length)),
      }),
    );
    g.chain(...writes, entry(target));
    g.link(gate, writes[0], "true");
    return gate;
  }
  const branchDeclaration = nodes[g.node("flow/branch")].declaration;
  const nativeClones = new Map();
  function native(id) {
    if (nativeClones.has(id)) return nativeClones.get(id);
    const clone = nodes.length;
    nativeClones.set(id, clone);
    nodes.push({ ...original[id], flows: {} });
    nodes[clone].flows = Object.fromEntries(
      Object.entries(original[id].flows).map(([key, edge]) => [
        key,
        { ...edge, node: native(edge.node) },
      ]),
    );
    if (op(original[id]).startsWith("pointer/"))
      nodes[clone].flows.err = { node: fault, socket: "in" };
    if (!Object.keys(nodes[clone].flows).length) delete nodes[clone].flows;
    return clone;
  }
  for (const id of effective) {
    const source = original[id],
      n = nodes[id],
      operation = op(source);
    if (operation === "flow/sequence") {
      const children = Object.keys(source.flows)
        .sort()
        .map((key) => source.flows[key].node);
      n.flows = {
        out: {
          node: !children.length
            ? end(id)
            : children.length === 1
              ? entry(children[0])
              : !needsStack(children[0])
                ? entry(children[0])
                : push(children.slice(1).reverse(), children[0]),
          socket: "in",
        },
      };
    } else if (operation === "flow/while" && batched.has(id)) {
      const healthy = g.data("math/not", "bool", { a: g.get(k.vars.fault) });
      const loop = g.node("flow/while", {
        condition: g.math(
          "and",
          "bool",
          healthy,
          g.math(
            "and",
            "bool",
            source.values.condition,
            g.math("lt", "bool", g.get(used), g.get(limit)),
          ),
        ),
      });
      const body = g.node("flow/sequence");
      g.link(body, native(source.flows.loopBody.node), "0");
      g.link(
        body,
        g.set({ [used]: g.math("add", "int", g.get(used), i(1)) }),
        "1",
      );
      g.link(loop, body, "loopBody");
      const finished = g.node("flow/sequence");
      const check = g.node("flow/branch", {
        condition: source.values.condition,
      });
      g.link(check, g.set({ [state]: i(states.get(id)) }), "true");
      g.link(check, next(source.flows.completed, id), "false");
      const health = g.node("flow/branch", { condition: healthy });
      g.link(health, check, "true");
      g.link(finished, health, "0");
      g.link(loop, finished, "completed");
      n.declaration = nodes[finished].declaration;
      delete n.values;
      delete n.configuration;
      n.flows = { out: { node: loop, socket: "in" } };
    } else if (operation === "flow/while") {
      n.declaration = branchDeclaration;
      n.flows = {
        true: {
          node: source.flows.loopBody
            ? !needsStack(source.flows.loopBody.node)
              ? entry(source.flows.loopBody.node)
              : push([id], source.flows.loopBody.node)
            : fault,
          socket: "in",
        },
        false: { node: next(source.flows.completed, id), socket: "in" },
      };
    } else if (operation === "flow/branch") {
      n.flows = Object.fromEntries(
        ["true", "false"].map((key) => [
          key,
          { node: next(source.flows[key], id), socket: "in" },
        ]),
      );
    } else if (
      [
        "variable/set",
        "pointer/set",
        "pointer/interpolate",
        "event/send",
      ].includes(operation)
    ) {
      if (Object.keys(source.flows).some((key) => key !== "out"))
        throw new Error(
          "Asynchronous continuation needs an explicit source frame handler",
        );
      n.flows = { out: { node: next(source.flows.out, id), socket: "in" } };
      if (operation.startsWith("pointer/"))
        n.flows.err = { node: fault, socket: "in" };
    } else throw new Error("Cannot cooperatively lower " + operation);
  }
  function dispatch(lo, hi) {
    if (hi - lo === 1) return ids[lo];
    const mid = (lo + hi) >> 1;
    const branch = g.node("flow/branch", {
      condition: g.math("lt", "bool", g.get(state), i(mid)),
    });
    g.link(branch, dispatch(lo, mid), "true");
    g.link(branch, dispatch(mid, hi), "false");
    return branch;
  }
  const loop = g.node("flow/while", {
    condition: g.math(
      "and",
      "bool",
      g.math("ge", "bool", g.get(state), i(0)),
      g.math("lt", "bool", g.get(used), g.get(limit)),
    ),
  });
  const body = g.node("flow/sequence");
  g.link(loop, body, "loopBody");
  g.link(body, g.set({ [workStart]: g.get(used) }), "0");
  g.link(body, dispatch(0, ids.length), "1");
  g.link(
    body,
    g.set({
      [used]: g.math(
        "max",
        "int",
        g.get(used),
        g.math("add", "int", g.get(workStart), i(1)),
      ),
    }),
    "2",
  );
  nodes[resume].flows = {
    out: {
      node: g.set({
        [used]: i(0),
        [slices]: g.math("add", "int", g.get(slices), i(1)),
      }),
      socket: "in",
    },
  };
  g.link(nodes[resume].flows.out.node, loop);
  // Replace external callback entries, leaving dispatch entries pointing to the original states.
  const launches = new Map(
    roots.map((root) => [
      root,
      g.set({ [state]: i(states.get(root)), [sp]: i(0), [k.vars.pc]: i(1) }),
    ]),
  );
  for (const launch of launches.values()) g.link(launch, resume);
  for (let id = 0; id < original.length; id++)
    if (!control.has(id))
      for (const edge of Object.values(nodes[id].flows ?? {}))
        if (launches.has(edge.node)) edge.node = launches.get(edge.node);
  const event = g.graph.events.length;
  g.graph.events.push({
    id: "interactivity-script:budget",
    values: { steps: { type: g.type("int") } },
  });
  const receive = g.node("event/receive", {}, { event });
  const requested = g.output(receive, "int", "steps");
  g.link(
    receive,
    g.set({
      [limit]: g.math(
        "min",
        "int",
        i(65536),
        g.math("max", "int", i(1), requested),
      ),
    }),
  );
  g.pruneNodes();
  g.orderFlows();
  k.cooperative = {
    state,
    stackDepth: sp,
    limit,
    used,
    slices,
    stackCapacity,
    states: ids.length,
    budgetEvent: "interactivity-script:budget",
  };
}
