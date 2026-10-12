import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/index.mjs";
import { compile as compileIR, VM } from "../src/reference.mjs";
import { runGraph } from "./runtime.mjs";

function load(compiled) {
  return runGraph(compiled.graph, (engine) => {
    const base = engine.resolveJsonPtr;
    engine.resolveJsonPtr = (path) => {
      const match = /^\/nodes\/(\d+)\/weights\/(\d+)$/.exec(path);
      if (!match) return base(path);
      const node = compiled.asset.doc.nodes[Number(match[1])],
        slot = Number(match[2]);
      return {
        typeName: "float",
        readOnly: false,
        getValue: () => [node.weights[slot]],
        setValue: (_, value) => {
          node.weights[slot] = Array.isArray(value) ? value[0] : value;
        },
      };
    };
  });
}

test("cooperative callbacks preserve recursive locals, yields, immediate frames and queued jobs", () => {
  const source = `var result=0,frames=0,presented=0;
    function fib(n){if(n<2)return n;return fib(n-1)+fib(n-2);}
    function go(n){result=fib(n);}
    function frame(time,delta){frames++;presented=fib(3);}
    events.onReceive('go',go,['int']);events.onFrame(frame);`;
  const compiled = compile(source, { cooperative: { stepsPerTick: 3 } });
  const r = runGraph(compiled.graph, (engine) => {
      const base = engine.resolveJsonPtr;
      engine.resolveJsonPtr = (path) => {
        const match = /^\/nodes\/(\d+)\/weights\/(\d+)$/.exec(path);
        if (!match) return base(path);
        const node = compiled.asset.doc.nodes[Number(match[1])],
          slot = Number(match[2]);
        return {
          typeName: "float",
          readOnly: false,
          getValue: () => [node.weights[slot]],
          setValue: (_, value) => {
            node.weights[slot] = Array.isArray(value) ? value[0] : value;
          },
        };
      };
    }),
    c = compiled.metadata.cooperative;
  try {
    r.bus.dispatchCustomEvent("KHR_INTERACTIVITY:go", { n: 8 });
    let ticks = 0;
    do {
      r.engine.executeEventQueueTick();
      ticks++;
    } while (
      (r.engine.variables[compiled.metadata.vars.pc].value[0] >= 0 ||
        ticks < 2) &&
      ticks < 5000
    );
    assert.ok(ticks > 20 && ticks < 5000, `ticks=${ticks}`);
    assert.deepEqual(r.value("JS global result"), [21]);
    assert.deepEqual(r.value("JS global presented"), [2]);
    assert.ok(r.value("JS global frames")[0] >= ticks);
    assert.ok(r.engine.variables[c.used].value[0] <= 3);
    assert.equal(
      r.engine.variables[compiled.metadata.vars.fault].value[0],
      false,
    );
  } finally {
    r.dispose();
  }
});

test("source event sends expose matching graph and reference payloads", () => {
  const source = `function main(){events.send('moved',{from:85,to:65,ply:1});}`;
  const compiled = compile(source);
  const oracle = new VM(compileIR(source));
  oracle.run("main");
  let payload;
  const r = runGraph(compiled.graph, (engine) =>
    engine.addCustomEventListener("KHR_INTERACTIVITY:moved", (e) => {
      payload = e.detail;
    }),
  );
  try {
    r.engine.executeEventQueueTick();
    assert.deepEqual(payload, { from: 85, to: 65, ply: 1 });
    assert.deepEqual(oracle.sentEvents, [{ id: "moved", values: payload }]);
  } finally {
    r.dispose();
  }
});

test("counted loops and entry-only programs resume without losing their loop index", () => {
  const c = compile(
    "var result=0;function main(){for(var j=0;j<37;j++)result+=j;}",
    { cooperative: { stepsPerTick: 2 } },
  );
  const r = load(c);
  try {
    let ticks = 0;
    while (
      r.engine.variables[c.metadata.vars.pc].value[0] >= 0 &&
      ticks++ < 1000
    )
      r.engine.executeEventQueueTick();
    assert.ok(ticks > 2 && ticks < 1000);
    assert.deepEqual(r.value("JS global result"), [666]);
    assert.equal(r.engine.variables[c.metadata.vars.fault].value[0], false);
  } finally {
    r.dispose();
  }
});

test("interrupt callbacks discard a suspended call stack and its queued work", () => {
  const c = compile(
    "var result=0;function fib(n){if(n<2)return n;return fib(n-1)+fib(n-2);}function go(n){result=fib(n);}function reset(){result=-1;}events.onReceive('go',go,['int']);events.onReceive('reset',reset,[],{interrupt:true});",
    { cooperative: { stepsPerTick: 3 } },
  );
  const r = load(c);
  try {
    r.bus.dispatchCustomEvent("KHR_INTERACTIVITY:go", { n: 12 });
    r.engine.executeEventQueueTick();
    assert.equal(r.engine.variables[c.metadata.vars.pc].value[0], 1);
    r.bus.dispatchCustomEvent("KHR_INTERACTIVITY:reset", {});
    for (let j = 0; j < 100; j++) r.engine.executeEventQueueTick();
    assert.deepEqual(r.value("JS global result"), [-1]);
    assert.equal(
      r.engine.variables[c.metadata.cooperative.stackDepth].value[0],
      0,
    );
    assert.equal(r.engine.variables[c.metadata.vars.fault].value[0], false);
  } finally {
    r.dispose();
  }
});

test("cooperative options and immediate-only programs have bounded behavior", () => {
  assert.throws(
    () => compile("function main(){}", { cooperative: true }),
    /options object/,
  );
  assert.throws(
    () =>
      compile("function main(){}", { cooperative: { stepsPerTick: 65537 } }),
    /Invalid cooperative option/,
  );
  const c = compile(
    "var frames=0;function frame(time){frames++;}events.onFrame(frame);",
    { cooperative: { stepsPerTick: 2 } },
  );
  const r = load(c);
  try {
    r.engine.executeEventQueueTick();
    assert.ok(r.value("JS global frames")[0] >= 1);
  } finally {
    r.dispose();
  }
});

test("source interpolation emits native vector/quaternion pointer nodes", () => {
  const c = compile(
    "function main(){scene.interpolateTranslation(0,1,2,3,.2);scene.interpolateRotation(0,0,0,0,1,.3);scene.interpolateScale(0,2,2,2,.4);}",
    {
      scene: {
        asset: { version: "2.0" },
        nodes: [{ name: "Target" }],
        scenes: [{ nodes: [0] }],
        scene: 0,
      },
    },
  );
  const writes = c.graph.nodes.filter(
    (n) => c.graph.declarations[n.declaration].op === "pointer/interpolate",
  );
  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes.map((n) => c.graph.types[n.values.value.type].signature),
    ["float3", "float4", "float3"],
  );
  assert.deepEqual(
    writes.map((n) => n.values.duration.value[0]),
    [0.2, 0.3, 0.4],
  );
});

test("batched loops preserve nested calls, break/continue and one-step budgets", () => {
  for (const stepsPerTick of [1, 3, 19]) {
    const source = `var result=0;
      function add(n){if(n%2)return n*2;return n+1;}
      function main(){for(var j=0;j<20;j++){for(var i=0;i<10;i++){if(i==3)continue;if(i==8)break;result+=add(j+i);}}}`;
    const oracle = new VM(compileIR(source));
    oracle.run("main");
    const c = compile(source, { cooperative: { stepsPerTick } }),
      r = load(c);
    try {
      let ticks = 0;
      while (
        r.engine.variables[c.metadata.vars.pc].value[0] >= 0 &&
        ticks++ < 5000
      ) {
        r.engine.executeEventQueueTick();
        assert.ok(
          r.engine.variables[c.metadata.cooperative.used].value[0] <=
            stepsPerTick,
        );
      }
      assert.ok(ticks > 2 && ticks < 5000);
      assert.equal(r.value("JS global result")[0], oracle.global("result"));
      assert.equal(r.engine.variables[c.metadata.vars.fault].value[0], false);
    } finally {
      r.dispose();
    }
  }
});

test("one-step slices do not double-spend a budget across adjacent native loops", () => {
  const c = compile(
      "var count=0;function main(){for(var i=0;i<5;i++)count++;for(var j=0;j<5;j++)count++;}",
      { cooperative: { stepsPerTick: 1 } },
    ),
    r = load(c);
  try {
    let previous = r.value("JS global count")[0],
      ticks = 0;
    while (
      r.engine.variables[c.metadata.vars.pc].value[0] >= 0 &&
      ticks++ < 100
    ) {
      r.engine.executeEventQueueTick();
      const count = r.value("JS global count")[0];
      assert.ok(count - previous <= 1);
      previous = count;
    }
    assert.equal(previous, 10);
    assert.ok(ticks < 100);
  } finally {
    r.dispose();
  }
});
