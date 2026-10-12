import { Graph } from "./graph.mjs";
import { scalarCall, mathConstants, lowerScalar } from "../scalar.mjs";
import { sceneCall } from "./scene-api.mjs";

// Compile the source control structure directly. Function calls are shared
// sequence subgraphs; recursive SCCs have bounded, separate activation locals.
// Constant arguments specialize recursive contexts and remove unreachable calls.
export function lowerStructured(
  program,
  { heapNodeBase = 0, maxDepth = 24, optimize = true, cooperative = false } = {},
) {
  if (!program.syntax)
    throw new Error("Structured lowering requires source syntax");
  const g = new Graph("Numeric JavaScript: structured control"),
    f = (n) => g.literal("float", n),
    i = (n) => g.literal("int", n),
    b = (n) => g.literal("bool", n);
  const globals = Object.fromEntries(
    Object.entries(program.globals).map(([name, address]) => [
      name,
      g.variable(
        "JS global " + name,
        "float",
        Number.isFinite(program.data[address]) &&
          !Object.is(program.data[address], -0)
          ? program.data[address]
          : 0,
      ),
    ]),
  );
  const vars = {
    pc: g.variable(
      "callback state",
      "int",
      program.bindings.some((v) => v.kind === "Start") ? 1 : -1,
    ),
    fault: g.variable("fault", "bool", false),
    seed: g.variable("seed", "float", 1),
  };
  const definitions = Object.fromEntries(
    program.syntax.body
      .filter((n) => n.type === "FunctionDeclaration")
      .map((n) => [n.id.name, n]),
  );
  const terminalInstances = new Map();
  const instances = new Map(),
    arrayInitial = [...program.data];
  let temporary = 0;
  const fail = (node, msg) => {
    throw new SyntaxError(
      msg + " at " + node.loc.start.line + ":" + (node.loc.start.column + 1),
    );
  };
  const walk = (node, visit) => {
    if (!node || typeof node !== "object") return;
    if (node.type) visit(node);
    for (const [key, value] of Object.entries(node))
      if (!["loc", "start", "end"].includes(key)) {
        if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
        else if (value && typeof value === "object") walk(value, visit);
      }
  };
  const calls = (name) => program.functions[name].calls ?? [];
  const reaches = (a, z, seen = new Set()) => {
    if (a === z) return true;
    if (seen.has(a) || !program.functions[a]) return false;
    seen.add(a);
    return calls(a).some((v) => reaches(v, z, seen));
  };
  const component = Object.fromEntries(
    Object.keys(definitions).map((name) => [
      name,
      Object.keys(definitions)
        .filter((other) => reaches(name, other) && reaches(other, name))
        .sort()
        .join(","),
    ]),
  );
  const recursive = new Set(
    Object.keys(definitions).filter((name) =>
      calls(name).some((v) => reaches(v, name)),
    ),
  );
  const numeric = (e) =>
    e.type === "float" ? e.value : g.convert(e.value, e.type, "float");
  const integer = (e) =>
    e.type === "int" ? e.value : g.convert(e.value, e.type, "int");
  const truth = (e) =>
    e.type === "bool" ? e.value : g.convert(e.value, e.type, "bool");
  const literal = (value) => {
    if (typeof value === "boolean")
      return { value: b(value), type: "bool", constant: value };
    const type =
      Number.isInteger(value) && value === (value | 0) && !Object.is(value, -0)
        ? "int"
        : "float";
    const result =
      Number.isFinite(value) && !Object.is(value, -0)
        ? g.literal(type, value)
        : Object.is(value, -0)
          ? g.math("neg", "float", f(0))
          : g.math(
              "div",
              "float",
              f(Number.isNaN(value) ? 0 : value < 0 ? -1 : 1),
              f(0),
            );
    return { value: result, type, constant: value };
  };
  const exceptional = program.data.flatMap((value, address) =>
    typeof value === "number" &&
    (!Number.isFinite(value) || Object.is(value, -0))
      ? [{ value, address }]
      : [],
  );
  if (exceptional.length) {
    const start = g.node("event/onStart"),
      globalAddresses = new Map(
        Object.entries(program.globals).map(([name, address]) => [
          address,
          globals[name],
        ]),
      );
    const initialize = [];
    for (const { value, address: cell } of exceptional) {
      arrayInitial[cell] = 0;
      const expression = literal(value).value,
        id = globalAddresses.get(cell);
      initialize.push(
        id === undefined
          ? g.write("/nodes/[page]/weights/[slot]", "float", expression, {
              page: i(heapNodeBase + Math.floor(cell / 8)),
              slot: i(cell % 8),
            })
          : g.set({ [id]: expression }),
      );
    }
    g.chain(...initialize);
    g.link(start, initialize[0]);
  }
  const nodeValue = (value, type = "float", actions = []) => ({
    value,
    type,
    actions,
  });
  const actions = (e) => e.actions ?? [];
  const capture = (e) => {
    const id = g.variable(
      "expression " + temporary++,
      e.type,
      e.type === "bool" ? false : 0,
    );
    return {
      ...nodeValue(g.get(id), e.type, [
        ...actions(e),
        g.set({ [id]: e.value }),
      ]),
      ...(e.constant !== undefined ? { constant: e.constant } : {}),
      ...(e.domain ? { domain: e.domain } : {}),
    };
  };
  const join = (nodes, next) => {
    if (!nodes.length) return next;
    g.chain(...nodes);
    g.link(nodes.at(-1), next);
    return nodes[0];
  };
  const address = (base, index) =>
    g.convert(
      g.math("add", "float", numeric(base), numeric(index)),
      "float",
      "int",
    );
  const location = (addr) => ({
    page: g.math(
      "add",
      "int",
      i(heapNodeBase),
      g.math("asr", "int", addr, i(3)),
    ),
    slot: g.math("and", "int", addr, i(7)),
  });
  const read = (addr) =>
    g.pointer("/nodes/[page]/weights/[slot]", "float", location(addr));
  const write = (addr, value) =>
    g.write("/nodes/[page]/weights/[slot]", "float", value, location(addr));
  const pure = (node) =>
    node &&
    (["Identifier", "Literal"].includes(node.type) ||
      (node.type === "UnaryExpression" && pure(node.argument)) ||
      (["BinaryExpression", "LogicalExpression"].includes(node.type) &&
        pure(node.left) &&
        pure(node.right)) ||
      (node.type === "ConditionalExpression" &&
        pure(node.test) &&
        pure(node.consequent) &&
        pure(node.alternate)) ||
      (node.type === "MemberExpression" &&
        node.computed &&
        (pure(node.object) || node.object.type === "ArrayExpression") &&
        pure(node.property)));
  const operators = {
    "+": (a, c) => Number(a) + Number(c),
    "-": (a, c) => a - c,
    "*": (a, c) => a * c,
    "/": (a, c) => a / c,
    "%": (a, c) => a % c,
    "&": (a, c) => a & c,
    "|": (a, c) => a | c,
    "^": (a, c) => a ^ c,
    "<<": (a, c) => a << c,
    ">>": (a, c) => a >> c,
    ">>>": (a, c) => a >>> c,
    "==": (a, c) => Number(a) === Number(c),
    "===": (a, c) => Number(a) === Number(c),
    "!=": (a, c) => Number(a) !== Number(c),
    "!==": (a, c) => Number(a) !== Number(c),
    "<": (a, c) => a < c,
    "<=": (a, c) => a <= c,
    ">": (a, c) => a > c,
    ">=": (a, c) => a >= c,
  };
  const globalDomains = {};
  for (const [name, addr] of Object.entries(program.globals)) {
    const values = new Set([program.data[addr]]);
    let signedZero = Object.is(program.data[addr], -0);
    let valid = true;
    for (const [fnName, fn] of Object.entries(definitions))
      walk(fn.body, (node) => {
        if (name in program.functions[fnName].locals) return;
        if (node.type === "UpdateExpression" && node.argument.name === name)
          valid = false;
        if (node.type === "AssignmentExpression" && node.left.name === name) {
          const rhs = node.right;
          let val =
            rhs.type === "Literal"
              ? Number(rhs.value)
              : rhs.type === "UnaryExpression" &&
                  ["-", "+"].includes(rhs.operator) &&
                  rhs.argument.type === "Literal"
                ? (rhs.operator === "-" ? -1 : 1) * Number(rhs.argument.value)
                : undefined;
          if (
            node.operator !== "=" ||
            val === undefined ||
            !Number.isFinite(val)
          )
            valid = false;
          else {
            signedZero ||= Object.is(val, -0);
            values.add(val);
          }
        }
      });
    if (valid && !signedZero && values.size <= 4)
      globalDomains[name] = [...values];
  }
  function staticValue(node, ctx, seen = new Set()) {
    if (!node) return 0;
    if (node.type === "Literal")
      return typeof node.value === "boolean"
        ? Number(node.value)
        : typeof node.value === "number"
          ? node.value
          : undefined;
    if (node.type === "Identifier") {
      if (Object.hasOwn(ctx.constants, node.name))
        return ctx.constants[node.name];
      if (!(node.name in ctx.locals) && globalDomains[node.name]?.length === 1)
        return globalDomains[node.name][0];
      const fact = ctx.facts[node.name];
      if (fact && node.start > fact.end && !seen.has(node.name)) {
        const next = new Set(seen);
        next.add(node.name);
        return staticValue(fact.value, ctx, next);
      }
      return undefined;
    }
    if (node.type === "UnaryExpression") {
      const x = staticValue(node.argument, ctx, seen);
      if (x === undefined) return undefined;
      return { "+": () => +x, "-": () => -x, "!": () => !x, "~": () => ~x }[
        node.operator
      ]?.();
    }
    if (node.type === "LogicalExpression") {
      const x = staticValue(node.left, ctx, seen);
      if (x === undefined) return undefined;
      if ((node.operator === "&&" && !x) || (node.operator === "||" && x))
        return x;
      return staticValue(node.right, ctx, seen);
    }
    if (node.type === "ConditionalExpression") {
      const x = staticValue(node.test, ctx, seen);
      return x === undefined
        ? undefined
        : staticValue(x ? node.consequent : node.alternate, ctx, seen);
    }
    if (node.type === "BinaryExpression") {
      const x = staticValue(node.left, ctx, seen),
        y = staticValue(node.right, ctx, seen);
      return x === undefined || y === undefined
        ? undefined
        : operators[node.operator]?.(x, y);
    }
    return undefined;
  }
  const dependenciesCache = new Map();
  function dependencies(value) {
    if (value.node === undefined) return new Set();
    const key = value.node + ":" + value.socket;
    if (dependenciesCache.has(key)) return dependenciesCache.get(key);
    const node = g.graph.nodes[value.node],
      op = g.graph.declarations[node.declaration].op,
      result = new Set();
    if (op === "variable/get") result.add(node.configuration.variable.value[0]);
    else {
      for (const input of Object.values(node.values ?? {}))
        for (const v of dependencies(input)) result.add(v);
      if (op === "pointer/get") {
        result.add("memory");
        result.add("scene");
      }
    }
    dependenciesCache.set(key, result);
    return result;
  }
  const summaries = {};
  for (const [name, fn] of Object.entries(definitions)) {
    const effects = new Set();
    walk(fn.body, (n) => {
      if (
        n.type === "AssignmentExpression" &&
        n.left.type === "Identifier" &&
        !(n.left.name in program.functions[name].locals)
      )
        effects.add(globals[n.left.name]);
      if (
        n.type === "UpdateExpression" &&
        !(n.argument.name in program.functions[name].locals)
      )
        effects.add(globals[n.argument.name]);
      if (
        (n.type === "AssignmentExpression" &&
          n.left.type === "MemberExpression") ||
        (n.type === "ArrayExpression" && !program.arrays[n.start]?.immutable)
      ) {
        effects.add("memory");
        effects.add("scene");
      }
      if (
        n.type === "CallExpression" &&
        n.callee.object?.name === "scene" &&
        n.callee.property.name.startsWith("set")
      ) {
        effects.add("scene");
        effects.add("memory");
      }
      if (
        n.type === "CallExpression" &&
        ["Math", "math"].includes(n.callee.object?.name) &&
        n.callee.property.name === "random"
      )
        effects.add(vars.seed);
    });
    summaries[name] = effects;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of Object.keys(definitions))
      for (const call of calls(name))
        for (const v of summaries[call] ?? []) {
          if (!summaries[name].has(v)) {
            summaries[name].add(v);
            changed = true;
          }
        }
  }
  function effects(node, ctx) {
    const result = new Set();
    walk(node, (n) => {
      if (n.type === "VariableDeclarator" && n.init) result.add(binding(ctx, n.id.name));
      if (n.type === "AssignmentExpression")
        if (n.left.type === "Identifier") result.add(binding(ctx, n.left.name));
        else {
          result.add("memory");
          result.add("scene");
        }
      if (n.type === "UpdateExpression")
        result.add(binding(ctx, n.argument.name));
      if (n.type === "ArrayExpression" && !program.arrays[n.start]?.immutable) {
        result.add("memory");
        result.add("scene");
      }
      if (n.type === "CallExpression") {
        if (n.callee.type === "Identifier")
          for (const v of summaries[n.callee.name] ?? []) result.add(v);
        if (
          ["Math", "math"].includes(n.callee.object?.name) &&
          n.callee.property.name === "random"
        )
          result.add(vars.seed);
        if (
          n.callee.object?.name === "scene" &&
          n.callee.property.name.startsWith("set")
        ) {
          result.add("memory");
          result.add("scene");
        }
      }
    });
    return result;
  }
  const conflicts = (e, mutations) =>
    [...dependencies(e.value)].some((v) => mutations?.has(v));
  function binary(op, left, right) {
    const flow = [...actions(left)];
    if (actions(right).length && conflicts(left, right.writes)) {
      left = capture({ ...left, actions: [] });
      flow.push(...actions(left));
    }
    flow.push(...actions(right));
    if (
      ["&", "|", "^"].includes(op) &&
      left.type === "bool" &&
      right.type === "bool"
    )
      return nodeValue(
        g.math(
          { "&": "and", "|": "or", "^": "xor" }[op],
          "bool",
          left.value,
          right.value,
        ),
        "bool",
        flow,
      );
    if (["&", "|", "^", "<<", ">>"].includes(op)) {
      const name = {
        "&": "and",
        "|": "or",
        "^": "xor",
        "<<": "lsl",
        ">>": "asr",
      }[op];
      return nodeValue(
        g.math(name, "int", integer(left), integer(right)),
        "int",
        flow,
      );
    }
    if (op === ">>>") {
      const signed = g.convert(integer(left), "int", "float"),
        unsigned = g.select(
          g.math("lt", "bool", signed, f(0)),
          signed,
          g.math("add", "float", signed, f(4294967296)),
          "float",
        );
      const shift = g.math("and", "int", integer(right), i(31));
      return nodeValue(
        g.math(
          "floor",
          "float",
          g.math(
            "div",
            "float",
            unsigned,
            g.math("pow", "float", f(2), g.convert(shift, "int", "float")),
          ),
        ),
        "float",
        flow,
      );
    }
    const comparison = {
      "==": "eq",
      "===": "eq",
      "!=": "eq",
      "!==": "eq",
      "<": "lt",
      "<=": "le",
      ">": "gt",
      ">=": "ge",
    }[op];
    if (comparison) {
      const bothInt = left.type === "int" && right.type === "int";
      let value = g.math(
        comparison,
        "bool",
        bothInt ? left.value : numeric(left),
        bothInt ? right.value : numeric(right),
      );
      if (["!=", "!=="].includes(op))
        value = g.data("math/not", "bool", { a: value });
      return nodeValue(value, "bool", flow);
    }
    return nodeValue(
      g.math(
        { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "rem" }[op],
        "float",
        numeric(left),
        numeric(right),
      ),
      "float",
      flow,
    );
  }
  const binding = (ctx, name) => ctx.locals[name] ?? globals[name];
  function operands(nodes, ctx) {
    const result = [],
      flow = [];
    for (let j = 0; j < nodes.length; j++) {
      let e = expression(nodes[j], ctx);
      if (actions(e).length) {
        for (let k = 0; k < result.length; k++) {
          if (
            result[k].constant !== undefined ||
            !conflicts(result[k], e.writes)
          )
            continue;
          const saved = capture({ ...result[k], actions: [] });
          flow.push(...actions(saved));
          result[k] = { ...saved, actions: [] };
        }
        flow.push(...actions(e));
      }
      result.push({ ...e, actions: [] });
    }
    return { result, flow };
  }
  const expressionKey = (node) =>
    JSON.stringify(node, (key, value) =>
      ["loc", "start", "end"].includes(key) ? undefined : value,
    );
  function loopInvariants(node, ctx) {
    const flow = [],
      hoists = new Map(ctx.hoists ?? []),
      mutations = effects(node, ctx);
    const arithmetic = (n) =>
      n &&
      (["Identifier", "Literal"].includes(n.type) ||
        (n.type === "MemberExpression" &&
          n.object.name === "Math" &&
          Object.hasOwn(mathConstants, n.property.name)) ||
        (n.type === "UnaryExpression" && arithmetic(n.argument)) ||
        (["BinaryExpression", "LogicalExpression"].includes(n.type) &&
          arithmetic(n.left) &&
          arithmetic(n.right)) ||
        (n.type === "ConditionalExpression" &&
          arithmetic(n.test) &&
          arithmetic(n.consequent) &&
          arithmetic(n.alternate)) ||
        (n.type === "CallExpression" &&
          ["Math", "math"].includes(n.callee.object?.name) &&
          n.callee.property.name !== "random" &&
          n.arguments.every(arithmetic)));
    const collect = (n) => {
      if (!n || typeof n !== "object") return;
      const bound =
        node.type === "ForStatement" && node.test?.type === "BinaryExpression"
          ? staticValue(node.test.right, ctx)
          : undefined;
      let expensive = false;
      walk(n, (x) => {
        if (
          x.type === "CallExpression" &&
          ["Math", "math"].includes(x.callee.object?.name) &&
          /^(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|log|log2|log10|sqrt|cbrt|pow)$/.test(
            x.callee.property.name,
          )
        )
          expensive = true;
      });
      // Cheap arithmetic can cost more to materialize than to repeat in short loops.
      if (
        arithmetic(n) &&
        !["Identifier", "Literal"].includes(n.type) &&
        (expensive || (Number.isFinite(bound) && bound >= 8))
      ) {
        const key = expressionKey(n);
        if (hoists.has(key)) return;
        const dependencies = new Set();
        walk(n, (x) => {
          if (
            x.type === "Identifier" &&
            (x.name in ctx.locals || x.name in globals)
          )
            dependencies.add(binding(ctx, x.name));
        });
        if (![...dependencies].some((id) => mutations.has(id))) {
          const e = expression(n, ctx);
          if (e.constant !== undefined || e.value.node === undefined) return;
          const operation =
            g.graph.declarations[g.graph.nodes[e.value.node].declaration].op;
          if (operation === "variable/get") return;
          const saved = capture(e);
          flow.push(...actions(saved));
          hoists.set(key, { ...saved, actions: [] });
          return;
        }
      }
      for (const [key, value] of Object.entries(n))
        if (!["loc", "start", "end"].includes(key)) {
          if (Array.isArray(value)) value.forEach(collect);
          else if (value && typeof value === "object") collect(value);
        }
    };
    collect(node.test);
    collect(node.update);
    collect(node.body);
    return { flow, ctx: { ...ctx, hoists } };
  }
  function expression(node, ctx, needed = true) {
    const hoisted = node && ctx.hoists?.get(expressionKey(node));
    if (hoisted) return { ...hoisted, writes: new Set() };
    return {
      ...buildExpression(node, ctx, needed),
      writes: effects(node, ctx),
    };
  }
  function buildExpression(node, ctx, needed = true) {
    if (!node) return literal(0);
    if (pure(node)) {
      const value = staticValue(node, ctx);
      if (value !== undefined) return literal(value);
    }
    switch (node.type) {
      case "Literal":
        return literal(Number(node.value));
      case "Identifier": {
        const value = nodeValue(g.get(binding(ctx, node.name)));
        if (!(node.name in ctx.locals) && globalDomains[node.name])
          value.domain = globalDomains[node.name];
        return value;
      }
      case "ArrayExpression": {
        const a = program.arrays[node.start];
        if (!a) fail(node, "Missing array allocation");
        const value = literal(a.base);
        if (a.immutable) return value;
        const reset = g.node("flow/for", {
            startIndex: i(0),
            endIndex: i(a.capacity),
          }),
          index = g.output(reset, "int", "index");
        const cases = a.values.flatMap((n, j) =>
            n !== 0 || Object.is(n, -0) ? [j] : [],
          ),
          v = cases.length
            ? g.data(
                "math/switch",
                "float",
                {
                  selection: index,
                  default: f(0),
                  ...Object.fromEntries(
                    cases.map((j) => [j, numeric(literal(a.values[j]))]),
                  ),
                },
                { cases },
              )
            : f(0);
        g.link(
          reset,
          write(g.math("add", "int", i(a.base), index), v),
          "loopBody",
        );
        const call = g.node("flow/sequence");
        g.link(call, reset, "0");
        return { ...value, actions: [call] };
      }
      case "MemberExpression": {
        if (
          node.object.name === "Math" &&
          Object.hasOwn(mathConstants, node.property.name)
        )
          return literal(mathConstants[node.property.name]);
        if (
          node.object.type === "ArrayExpression" &&
          program.arrays[node.object.start].immutable
        ) {
          const a = program.arrays[node.object.start],
            index = expression(node.property, ctx);
          const cases = a.values.map((_, j) => j);
          return nodeValue(
            g.data(
              "math/switch",
              "float",
              {
                selection: integer(index),
                default: f(0),
                ...Object.fromEntries(a.values.map((v, j) => [j, f(v)])),
              },
              { cases },
            ),
            "float",
            actions(index),
          );
        }
        const {
          result: [base, index],
          flow,
        } = operands([node.object, node.property], ctx);
        return nodeValue(read(address(base, index)), "float", flow);
      }
      case "BinaryExpression":
        return binary(
          node.operator,
          expression(node.left, ctx),
          expression(node.right, ctx),
        );
      case "UnaryExpression": {
        const e = expression(node.argument, ctx);
        if (node.operator === "+")
          return nodeValue(numeric(e), "float", actions(e));
        if (node.operator === "-")
          return nodeValue(
            g.math("neg", "float", numeric(e)),
            "float",
            actions(e),
          );
        if (node.operator === "~")
          return nodeValue(g.math("not", "int", integer(e)), "int", actions(e));
        return nodeValue(
          g.data("math/not", "bool", { a: truth(e) }),
          "bool",
          actions(e),
        );
      }
      case "SequenceExpression": {
        const flow = [];
        let value;
        node.expressions.forEach((n, j) => {
          value = expression(
            n,
            ctx,
            needed && j === node.expressions.length - 1,
          );
          flow.push(...actions(value));
        });
        return { ...value, actions: flow };
      }
      case "ConditionalExpression":
      case "LogicalExpression": {
        const logical = node.type === "LogicalExpression",
          testNode = logical ? node.left : node.test,
          test = expression(testNode, ctx);
        if (test.constant !== undefined)
          return logical
            ? (node.operator === "&&" ? !!test.constant : !test.constant)
              ? expression(node.right, ctx)
              : test
            : expression(test.constant ? node.consequent : node.alternate, ctx);
        const yes = logical
            ? node.operator === "&&"
              ? expression(node.right, ctx)
              : { ...test, actions: [] }
            : expression(node.consequent, ctx),
          no = logical
            ? node.operator === "&&"
              ? { ...test, actions: [] }
              : expression(node.right, ctx)
            : expression(node.alternate, ctx);
        const same = yes.type === no.type,
          type = same ? yes.type : "float",
          a = same ? yes.value : numeric(yes),
          z = same ? no.value : numeric(no);
        const complexity = (n) => {
          let count = 0;
          walk(n, (v) => {
            if (!["Literal", "Identifier"].includes(v.type)) count++;
          });
          return count;
        };
        const branchValues = logical
          ? Math.max(complexity(node.left), complexity(node.right))
          : Math.max(complexity(node.consequent), complexity(node.alternate));
        if (
          !actions(yes).length &&
          !actions(no).length &&
          (ctx.valueOnly || branchValues < 3)
        )
          return nodeValue(
            g.select(truth(test), z, a, type),
            type,
            actions(test),
          );
        const id = g.variable(
            "choice " + temporary++,
            type,
            type === "bool" ? false : 0,
          ),
          branch = actions(test).length
            ? join(
                actions(test),
                (() => {
                  const branch = g.node("flow/branch", {
                    condition: truth(test),
                  });
                  g.link(
                    branch,
                    join(actions(yes), g.set({ [id]: a })),
                    "true",
                  );
                  g.link(
                    branch,
                    join(actions(no), g.set({ [id]: z })),
                    "false",
                  );
                  return branch;
                })(),
              )
            : condition(
                testNode,
                join(actions(yes), g.set({ [id]: a })),
                join(actions(no), g.set({ [id]: z })),
                ctx,
              );
        const invoke = g.node("flow/sequence");
        g.link(invoke, branch, "0");
        return nodeValue(g.get(id), type, [invoke]);
      }
      case "AssignmentExpression": {
        const indexed = node.left.type === "MemberExpression";
        let flow = [],
          old;
        let addr;
        if (indexed) {
          const args = operands([node.left.object, node.left.property], ctx);
          flow = args.flow;
          addr = address(...args.result);
          old = nodeValue(read(addr));
        } else old = nodeValue(g.get(binding(ctx, node.left.name)));
        let rhs = expression(node.right, ctx);
        if (
          indexed &&
          actions(rhs).length &&
          [...dependencies(addr)].some((v) => rhs.writes.has(v))
        ) {
          const id = g.variable("address " + temporary++, "int", 0);
          flow.push(g.set({ [id]: addr }));
          addr = g.get(id);
          old = nodeValue(read(addr));
        }
        if (node.operator !== "=") {
          rhs = binary(node.operator.slice(0, -1), old, rhs);
        }
        flow.push(...actions(rhs));
        const value = numeric(rhs),
          temp =
            needed && indexed
              ? g.variable("assignment " + temporary++, "float", 0)
              : undefined;
        if (indexed) {
          if (needed) flow.push(g.set({ [temp]: value }));
          flow.push(write(addr, needed ? g.get(temp) : value));
        } else flow.push(g.set({ [binding(ctx, node.left.name)]: value }));
        return nodeValue(
          needed
            ? indexed
              ? g.get(temp)
              : g.get(binding(ctx, node.left.name))
            : f(0),
          "float",
          flow,
        );
      }
      case "UpdateExpression": {
        const id = binding(ctx, node.argument.name),
          old = g.get(id),
          next = g.math(
            node.operator === "++" ? "add" : "sub",
            "float",
            old,
            f(1),
          ),
          temp =
            needed && !node.prefix
              ? g.variable("increment " + temporary++, "float", 0)
              : undefined;
        return nodeValue(
          needed ? (node.prefix ? g.get(id) : g.get(temp)) : f(0),
          "float",
          [
            g.set({
              [id]: next,
              ...(needed && !node.prefix ? { [temp]: old } : {}),
            }),
          ],
        );
      }
      case "CallExpression": {
        if (node.callee.type === "MemberExpression" && node.callee.object.name === "events" && node.callee.property.name === "send") {
          const [id, payload] = node.arguments;
          if (id?.type !== "Literal" || typeof id.value !== "string" || payload?.type !== "ObjectExpression") fail(node, "events.send requires a literal ID and payload object");
          const keys = payload.properties.map(p => p.key.name ?? p.key.value);
          const { result, flow } = operands(payload.properties.map(p => p.value), ctx);
          g.graph.events ??= [];
          let event = g.graph.events.findIndex(e => e.id === id.value);
          if (event < 0) event = g.graph.events.push({ id: id.value, values: Object.fromEntries(keys.map(key => [key, { type: g.type("float") }])) }) - 1;
          else if (JSON.stringify(Object.keys(g.graph.events[event].values ?? {})) !== JSON.stringify(keys)) fail(node, "Event payload signature mismatch");
          const values = Object.fromEntries(keys.map((key, j) => {
            const type = g.graph.types[g.graph.events[event].values[key].type].signature;
            return [key, type === "int" ? integer(result[j]) : type === "bool" ? truth(result[j]) : numeric(result[j])];
          }));
          flow.push(g.node("event/send", values, { event }));
          return nodeValue(f(0), "float", flow);
        }
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "scene"
        ) {
          const call = sceneCall(node, fail),
            { result, flow } = operands(call.arguments, ctx),
            d = call.descriptor,
            indices = Object.fromEntries(
              d.indices.map((n, j) => [n, integer(result[j])]),
            );
          if (!d.write) {
            const value = g.pointer(d.path, d.type, indices);
            return d.component === undefined
              ? nodeValue(value, d.type, flow)
              : nodeValue(g.extract(value, d.type, d.component), "float", flow);
          }
          const values = result.slice(d.indices.length),
            value =
              d.type === "float4"
                ? g.vec4(...values.map(numeric))
                : d.type === "float3"
                  ? g.vec3(...values.map(numeric))
                  : d.type === "bool"
                    ? truth(values[0])
                    : d.type === "int"
                      ? integer(values[0])
                      : numeric(values[0]);
          flow.push(d.interpolate
            ? g.node("pointer/interpolate", {
                ...indices, value, duration: numeric(values.at(-1)),
                p1: g.literal("float2", [0.2, 0]), p2: g.literal("float2", [0.2, 1]),
              }, { pointer: d.path, type: g.type(d.type) })
            : g.write(d.path, d.type, value, indices));
          return nodeValue(f(0), "float", flow);
        }
        if (
          node.callee.type === "MemberExpression" &&
          ["Math", "math"].includes(node.callee.object.name)
        ) {
          if (node.callee.property.name === "floor") {
            const e = expression(node.arguments[0], ctx);
            return nodeValue(
              g.math("floor", "float", numeric(e)),
              "float",
              actions(e),
            );
          }
          if (node.callee.property.name !== "random") {
            const d = scalarCall(node, fail),
              { result, flow } = operands(node.arguments, ctx);
            const values = Object.fromEntries(
              d.inputs.map((input, j) => [
                input.name,
                input.type === "int"
                  ? integer(result[j])
                  : input.type === "bool"
                    ? truth(result[j])
                    : numeric(result[j]),
              ]),
            );
            return nodeValue(lowerScalar(g, d, values), d.output, flow);
          }
          const value = g.math(
            "rem",
            "float",
            g.math(
              "add",
              "float",
              g.math("mul", "float", g.get(vars.seed), f(1664525)),
              f(1013904223),
            ),
            f(4294967296),
          );
          return nodeValue(
            g.math("div", "float", g.get(vars.seed), f(4294967296)),
            "float",
            [g.set({ [vars.seed]: value })],
          );
        }
        const { result, flow } = operands(node.arguments, ctx),
          name = node.callee.name;
        const resultVar = needed
            ? g.variable("call result " + temporary++, "float", 0)
            : undefined,
          sequence = g.node("flow/sequence");
        function choose(position, constants) {
          if (position === result.length) {
            const fn = instance(name, constants, ctx);
            ctx.calls.add(fn);
            const prepare = g.set({
              ...Object.fromEntries(
                Object.entries(fn.locals).map(([n, id]) => [
                  id,
                  fn.params.includes(n)
                    ? numeric(result[fn.params.indexOf(n)])
                    : f(0),
                ]),
              ),
              [fn.returned]: b(false),
              [fn.result]: f(0),
            });
            g.link(prepare, fn.entry);
            if (!needed) return prepare;
            const invoke = g.node("flow/sequence");
            g.link(invoke, prepare, "0");
            g.link(invoke, g.set({ [resultVar]: g.get(fn.result) }));
            return invoke;
          }
          const e = result[position],
            param = program.functions[name].params[position];
          if (e.constant !== undefined)
            return choose(position + 1, {
              ...constants,
              [param]: Number(e.constant),
            });
          if (e.domain?.length && e.domain.length <= 4) {
            const first = e.domain[0],
              rest = e.domain.slice(1);
            const branches = [...rest, first].map((v) =>
              choose(position + 1, { ...constants, [param]: v }),
            );
            let head = branches.at(-1);
            for (let j = rest.length - 1; j >= 0; j--) {
              const branch = g.node("flow/branch", {
                condition: g.math("eq", "bool", numeric(e), f(rest[j])),
              });
              g.link(branch, branches[j], "true");
              g.link(branch, head, "false");
              head = branch;
            }
            return head;
          }
          return choose(position + 1, constants);
        }
        g.link(sequence, choose(0, {}), "0");
        return nodeValue(needed ? g.get(resultVar) : f(0), "float", [
          ...flow,
          sequence,
        ]);
      }
      default:
        fail(node, "Unsupported structured expression " + node.type);
    }
  }
  const isBoolean = (node) =>
    node &&
    ((node.type === "UnaryExpression" && node.operator === "!") ||
      (node.type === "BinaryExpression" &&
        ["==", "===", "!=", "!==", "<", "<=", ">", ">="].includes(
          node.operator,
        )));
  function condition(node, yes, no, ctx, intCoercion = false) {
    const known = staticValue(node, ctx);
    if (pure(node) && known !== undefined)
      return (intCoercion ? !!(Number(known) | 0) : !!known) ? yes : no;
    if (node.type === "ConditionalExpression")
      return condition(
        node.test,
        condition(node.consequent, yes, no, ctx, intCoercion),
        condition(node.alternate, yes, no, ctx, intCoercion),
        ctx,
      );
    if (node.type === "SequenceExpression")
      return join(
        node.expressions
          .slice(0, -1)
          .flatMap((n) => actions(expression(n, ctx, false))),
        condition(node.expressions.at(-1), yes, no, ctx, intCoercion),
      );
    if (
      node.type === "UnaryExpression" &&
      node.operator === "!" &&
      !intCoercion
    )
      return condition(node.argument, no, yes, ctx);
    if (node.type === "LogicalExpression" && !intCoercion)
      return node.operator === "&&"
        ? condition(
            node.left,
            condition(node.right, yes, no, ctx, intCoercion),
            no,
            ctx,
            intCoercion,
          )
        : condition(
            node.left,
            yes,
            condition(node.right, yes, no, ctx, intCoercion),
            ctx,
            intCoercion,
          );
    if (
      node.type === "BinaryExpression" &&
      node.operator === "|" &&
      pure(node.left) &&
      pure(node.right)
    )
      return condition(
        node.left,
        yes,
        condition(node.right, yes, no, ctx, true),
        ctx,
        true,
      );
    if (
      node.type === "BinaryExpression" &&
      node.operator === "&" &&
      isBoolean(node.left) &&
      isBoolean(node.right) &&
      pure(node)
    )
      return condition(node.left, condition(node.right, yes, no, ctx), no, ctx);
    const e = expression(node, ctx),
      branch = g.node("flow/branch", {
        condition:
          intCoercion && e.type !== "bool"
            ? g.convert(integer(e), "int", "bool")
            : truth(e),
      });
    g.link(branch, yes, "true");
    g.link(branch, no, "false");
    return join(actions(e), branch);
  }
  function predicate(node, ctx, intCoercion = false) {
    const known = staticValue(node, ctx);
    if (known !== undefined)
      return b(intCoercion ? !!(Number(known) | 0) : !!known);
    if (
      node.type === "UnaryExpression" &&
      node.operator === "!" &&
      !intCoercion
    )
      return g.data("math/not", "bool", { a: predicate(node.argument, ctx) });
    if (node.type === "LogicalExpression" && !intCoercion)
      return g.math(
        node.operator === "&&" ? "and" : "or",
        "bool",
        predicate(node.left, ctx, intCoercion),
        predicate(node.right, ctx, intCoercion),
      );
    if (node.type === "BinaryExpression" && node.operator === "|")
      return g.math(
        "or",
        "bool",
        predicate(node.left, ctx, true),
        predicate(node.right, ctx, true),
      );
    if (
      node.type === "BinaryExpression" &&
      node.operator === "&" &&
      isBoolean(node.left) &&
      isBoolean(node.right)
    )
      return g.math(
        "and",
        "bool",
        predicate(node.left, ctx),
        predicate(node.right, ctx),
      );
    const e = expression(node, { ...ctx, valueOnly: true });
    return intCoercion && e.type !== "bool"
      ? g.convert(integer(e), "int", "bool")
      : truth(e);
  }
  const fallsThrough = (node, ctx) => {
    if (!node) return true;
    if (
      ["ReturnStatement", "BreakStatement", "ContinueStatement"].includes(
        node.type,
      )
    )
      return false;
    if (node.type === "BlockStatement")
      return node.body.every((n) => fallsThrough(n, ctx));
    if (node.type === "IfStatement") {
      const test = staticValue(node.test, ctx);
      return test !== undefined
        ? fallsThrough(test ? node.consequent : node.alternate, ctx)
        : fallsThrough(node.consequent, ctx) ||
            fallsThrough(node.alternate, ctx);
    }
    return true;
  };
  function statement(node, next, ctx, loop) {
    if (!node) return next;
    switch (node.type) {
      case "BlockStatement": {
        let head = next;
        const body = [];
        for (const n of node.body) {
          body.push(n);
          if (!fallsThrough(n, ctx)) break;
        }
        for (let j = body.length - 1; j >= 0; j--)
          head = statement(body[j], head, ctx, loop);
        return head;
      }
      case "EmptyStatement":
        return next;
      case "ExpressionStatement":
        return join(actions(expression(node.expression, ctx, false)), next);
      case "VariableDeclaration": {
        const flow = [];
        for (const d of node.declarations)
          if (d.init) {
            const e = expression(d.init, ctx);
            flow.push(
              ...actions(e),
              g.set({ [binding(ctx, d.id.name)]: numeric(e) }),
            );
          }
        return join(flow, next);
      }
      case "ReturnStatement": {
        const e = expression(node.argument, ctx);
        return join(
          actions(e),
          g.set({ [ctx.result]: numeric(e), [ctx.returned]: b(true) }),
        );
      }
      case "IfStatement": {
        const known = staticValue(node.test, ctx);
        if (pure(node.test) && known !== undefined)
          return statement(
            known ? node.consequent : node.alternate,
            next,
            ctx,
            loop,
          );
        return condition(
          node.test,
          statement(node.consequent, next, ctx, loop),
          statement(node.alternate, next, ctx, loop),
          ctx,
        );
      }
      case "ForStatement":
      case "WhileStatement":
      case "DoWhileStatement": {
        const scope = optimize ? loopInvariants(node, ctx) : { flow: [], ctx };
        const parentContext = ctx;
        ctx = scope.ctx;
        const repeat = g.variable(
            "loop condition " + temporary++,
            "bool",
            false,
          ),
          test = node.test ?? { type: "Literal", value: 1 };
        let hasBreak = false,
          hasReturn = false;
        walk(node.body, (n) => {
          hasBreak ||= n.type === "BreakStatement";
          hasReturn ||= n.type === "ReturnStatement";
        });
        const direct =
          node.type !== "DoWhileStatement" && pure(test) && !hasBreak;
        let update = direct
          ? undefined
          : condition(
              test,
              g.set({ [repeat]: b(true) }),
              g.set({ [repeat]: b(false) }),
              ctx,
            );
        if (node.type === "ForStatement" && node.update)
          update = join(actions(expression(node.update, ctx, false)), update);
        const control = { repeat, continue: update },
          body = statement(node.body, update, ctx, control);
        let active = direct ? predicate(test, ctx) : g.get(repeat);
        if (hasReturn)
          active = g.math(
            "and",
            "bool",
            active,
            g.data("math/not", "bool", { a: g.get(ctx.returned) }),
          );
        const whileNode = g.node("flow/while", { condition: active });
        g.link(whileNode, body, "loopBody");
        if (hasReturn) {
          const completed = g.node("flow/branch", {
            condition: g.get(ctx.returned),
          });
          g.link(completed, next, "false");
          g.link(whileNode, completed, "completed");
        } else g.link(whileNode, next, "completed");
        const yes = g.set({ [repeat]: b(true) }),
          no = g.set({ [repeat]: b(false) });
        g.link(yes, whileNode);
        g.link(no, whileNode);
        let head = direct
          ? whileNode
          : node.type === "DoWhileStatement"
            ? yes
            : condition(test, yes, no, ctx);
        head = join(scope.flow, head);
        if (node.type === "ForStatement" && node.init)
          head =
            node.init.type === "VariableDeclaration"
              ? statement(node.init, head, parentContext, loop)
              : join(
                  actions(expression(node.init, parentContext, false)),
                  head,
                );
        return head;
      }
      case "BreakStatement":
        return g.set({ [loop.repeat]: b(false) });
      case "ContinueStatement":
        return loop.continue;
      default:
        fail(node, "Unsupported structured statement " + node.type);
    }
  }
  function instance(name, constants = {}, parent) {
    const fn = definitions[name],
      meta = program.functions[name],
      level =
        recursive.has(name) &&
        parent &&
        component[parent.name] === component[name]
          ? parent.level + 1
          : 0;
    const writes = new Map();
    walk(fn.body, (n) => {
      let id, value;
      if (n.type === "AssignmentExpression" && n.left.type === "Identifier") {
        id = n.left.name;
        value = n.operator === "=" ? n.right : undefined;
      }
      if (n.type === "UpdateExpression") {
        id = n.argument.name;
      }
      if (n.type === "VariableDeclarator" && n.init) {
        id = n.id.name;
        value = n.init;
      }
      if (id)
        writes.set(id, [...(writes.get(id) ?? []), { value, end: n.end }]);
    });
    const safe = Object.fromEntries(
        Object.entries(constants).filter(([n]) => !writes.has(n)),
      ),
      key =
        (parent?.namespace ? parent.namespace + ":" : "") + name +
        ":" +
        level +
        ":" +
        Object.entries(safe)
          .sort()
          .map(([n, v]) => n + "=" + (Object.is(v, -0) ? "-0" : String(v)))
          .join(";");
    if (instances.has(key)) return instances.get(key);
    const signature =
      (parent?.namespace ? parent.namespace + ":" : "") + name +
      ":" +
      Object.entries(safe)
        .sort()
        .map(([n, v]) => n + "=" + (Object.is(v, -0) ? "-0" : String(v)))
        .join(";");
    if (optimize && level < maxDepth && terminalInstances.has(signature))
      return terminalInstances.get(signature);
    const locals = Object.fromEntries(
        Object.keys(meta.locals).map((n) => [
          n,
          g.variable(key + " local " + n, "float", 0),
        ]),
      ),
      result = g.variable(key + " return", "float", 0),
      returned = g.variable(key + " returned", "bool", false),
      entry = g.node("flow/sequence");
    if (cooperative) g.graph.nodes[entry].extras = { cooperativeEntry: true };
    const facts = {};
    for (const [n, list] of writes)
      if (list.length === 1 && list[0].value && n in locals) {
        const record = list[0];
        let direct = false;
        for (const s of fn.body.body)
          if (
            (s.type === "VariableDeclaration" &&
              s.declarations.some(
                (d) => d.id.name === n && d.init === record.value,
              )) ||
            (s.type === "ExpressionStatement" &&
              s.expression.type === "AssignmentExpression" &&
              s.expression.operator === "=" &&
              s.expression.left.name === n &&
              s.expression.right === record.value)
          )
            direct = true;
        if (direct) facts[n] = record;
      }
    const ctx = {
      namespace: parent?.namespace ?? "",
      name,
      level,
      constants: safe,
      locals,
      result,
      returned,
      entry,
      params: meta.params,
      facts,
      calls: new Set(),
    };
    instances.set(key, ctx);
    if (level >= maxDepth) {
      g.link(entry, g.set({ [vars.fault]: b(true), [returned]: b(true) }), "0");
      return ctx;
    }
    g.link(entry, statement(fn.body, undefined, ctx), "0");
    if (!ctx.calls.size) terminalInstances.set(signature, ctx);
    return ctx;
  }
  const prepared = new Map(), anchors = [];
  const prepare = (name, values = [], namespace = "") => {
    const key = JSON.stringify([name, values, namespace]);
    if (prepared.has(key)) return prepared.get(key);
    const fn = instance(name, {}, { namespace });
    const initialize = g.set({
        ...Object.fromEntries(
          Object.entries(fn.locals).map(([n, id]) => [
            id,
            fn.params.includes(n)
              ? (values[fn.params.indexOf(n)] ?? f(0))
              : f(0),
          ]),
        ),
        [fn.result]: f(0),
        [fn.returned]: b(false),
        ...(namespace ? {} : { [vars.pc]: i(1) }),
      }),
      call = g.node("flow/sequence");
    g.link(initialize, fn.entry);
    g.link(call, initialize, "0");
    g.link(call, namespace ? g.node("flow/sequence") : g.set({ [vars.pc]: i(-1) }));
    prepared.set(key, call);
    return call;
  };
  const finish = () => {
    if (optimize) {
      const keep = [...Object.values(globals), ...Object.values(vars)];
      let changed;
      do {
        const removed = g.pruneNodes();
        for (const fn of instances.values()) fn.entry = removed.get(fn.entry);
        for (const anchor of anchors) anchor.node = removed.get(anchor.node);
        for (const [key, node] of prepared) prepared.set(key, removed.get(node));
        changed = g.eliminateDeadStores(keep);
        g.compactSequences();
      } while (changed);
      const ids = g.pruneVariables(keep);
      for (const fn of instances.values()) {
        for (const key of Object.keys(fn.locals))
          fn.locals[key] = ids.get(fn.locals[key]);
        fn.result = ids.get(fn.result);
        fn.returned = ids.get(fn.returned);
      }
      for (const map of [globals, vars])
        for (const key of Object.keys(map)) map[key] = ids.get(map[key]);
    }
    g.fuseVariableWrites();
    g.compactSequences();
    const pruned = g.pruneNodes();
    const mapping = g.orderFlows();
    for (const anchor of anchors) anchor.node = mapping[pruned.get(anchor.node)];
    for (const [key, node] of prepared) prepared.set(key, mapping[pruned.get(node)]);
    g.pruneTypes();
    for (const fn of instances.values())
      fn.entry = mapping[pruned.get(fn.entry)];
    return mapping;
  };
  return {
    g,
    vars,
    globals,
    instances,
    instance,
    prepare,
    prepared,
    track(node) { const anchor = { node }; anchors.push(anchor); return anchor; },
    finish,
    initial: arrayInitial,
    memorySize: arrayInitial.length,
    heapNodeBase,
    memory: read,
    writeMemory: write,
    variableMemory: false,
    structured: true,
    program,
  };
}
