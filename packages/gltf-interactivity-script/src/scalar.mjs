import { catalog } from "./catalog.mjs";
export const scalarOperations = Object.freeze(
  Object.fromEntries(
    Object.entries(catalog)
      .filter(
        ([op, s]) =>
          op.startsWith("math/") &&
          !["math/random", "math/switch"].includes(op) &&
          !s.flowInputs.length &&
          s.outputs.value?.types.some((t) =>
            ["float", "int", "bool"].includes(t),
          ) &&
          Object.values(s.inputs).every((v) =>
            v.types.some((t) => ["float", "int", "bool"].includes(t)),
          ),
      )
      .map(([op, s]) => [
        op.split("/")[1],
        {
          op,
          inputs: Object.entries(s.inputs).map(([name, v]) => ({
            name,
            type: v.types.includes("float")
              ? "float"
              : v.types.includes("int")
                ? "int"
                : "bool",
          })),
          output: s.outputs.value.types.includes("float")
            ? "float"
            : s.outputs.value.types.includes("int")
              ? "int"
              : "bool",
        },
      ]),
  ),
);
export function scalarCall(node, fail) {
  const name = node.callee.property.name,
    descriptor = scalarOperations[name];
  if (!descriptor) fail(node, "Unsupported scalar primitive " + name);
  if (node.arguments.length !== descriptor.inputs.length)
    fail(
      node,
      `${descriptor.op} requires ${descriptor.inputs.length} arguments (${descriptor.inputs.map((v) => v.name).join(", ")})`,
    );
  return {
    ...descriptor,
    jsRound: node.callee.object.name === "Math" && name === "round",
  };
}
export const mathConstants = {
  E: Math.E,
  PI: Math.PI,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  SQRT2: Math.SQRT2,
  SQRT1_2: Math.SQRT1_2,
};
export function evaluateScalar(op, args) {
  const name = op.split("/")[1],
    [a, b, c] = args;
  const functions = {
    E: () => Math.E,
    Pi: () => Math.PI,
    Tau: () => 2 * Math.PI,
    Inf: () => Infinity,
    NaN: () => NaN,
    abs: Math.abs,
    sign: Math.sign,
    trunc: Math.trunc,
    floor: Math.floor,
    ceil: Math.ceil,
    round: (a) => (a < 0 ? -Math.round(-a) : Math.round(a)),
    fract: (a) => a - Math.floor(a),
    neg: (a) => -a,
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    div: (a, b) => a / b,
    rem: (a, b) => a % b,
    min: Math.min,
    max: Math.max,
    clamp: (a, b, c) => Math.min(Math.max(a, b), c),
    saturate: (a) => Math.min(Math.max(a, 0), 1),
    mix: (a, b, c) => a * (1 - c) + b * c,
    pow: Math.pow,
    sqrt: Math.sqrt,
    exp: Math.exp,
    log: Math.log,
    log2: Math.log2,
    log10: Math.log10,
    exp2: (a) => 2 ** a,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    asinh: Math.asinh,
    acosh: Math.acosh,
    atanh: Math.atanh,
    rad: (a) => (a * Math.PI) / 180,
    deg: (a) => (a * 180) / Math.PI,
    smoothStep: (a, b, c) => {
      const t = Math.min(
        Math.max((c - Math.min(a, b)) / Math.abs(b - a), 0),
        1,
      );
      return t * t * (3 - 2 * t);
    },
    clz: Math.clz32,
    ctz: (a) => (a === 0 ? 32 : 31 - Math.clz32((a & -a) >>> 0)),
    popcnt: (a) => {
      let n = a >>> 0,
        count = 0;
      while (n) {
        n &= n - 1;
        count++;
      }
      return count;
    },
    select: (condition, a, b) => (condition ? a : b),
    eq: (a, b) => Number(a === b),
    lt: (a, b) => Number(a < b),
    le: (a, b) => Number(a <= b),
    gt: (a, b) => Number(a > b),
    ge: (a, b) => Number(a >= b),
    isNaN: (a) => Number(Number.isNaN(a)),
    isInf: (a) => Number(!Number.isFinite(a) && !Number.isNaN(a)),
    not: (a) => ~a,
    and: (a, b) => a & b,
    or: (a, b) => a | b,
    xor: (a, b) => a ^ b,
    lsl: (a, b) => a << b,
    asr: (a, b) => a >> b,
  };
  const fn = functions[name] ?? Math[name];
  if (typeof fn !== "function")
    throw new Error("No reference evaluator for " + op);
  return fn(a, b, c);
}

export function lowerScalar(g, descriptor, values) {
  if (!descriptor.jsRound)
    return g.data(descriptor.op, descriptor.output, values);
  const a = values.a,
    f = (n) => g.literal("float", n),
    floor = g.math("floor", "float", g.math("add", "float", a, f(0.5)));
  const nearZero = g.math(
    "and",
    "bool",
    g.math("lt", "bool", a, f(0)),
    g.math("ge", "bool", a, f(-0.5)),
  );
  const rounded = g.select(
    nearZero,
    floor,
    g.math("neg", "float", f(0)),
    "float",
  );
  return g.select(g.math("eq", "bool", a, f(0)), rounded, a, "float");
}
