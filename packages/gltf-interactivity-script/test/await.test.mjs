import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/index.mjs";
import { compile as compileIR, VM } from "../src/reference.mjs";
import { runGraph } from "./runtime.mjs";

// Deterministic graph time; the actual engine and all emitted nodes execute.
function load(source, options = {}) {
  const compiled = compile(source, options);
  let time = 1000;
  const r = runGraph(compiled.graph, engine => {
    Object.defineProperty(engine, "lastTickTime", { get: () => time });
    const base = engine.resolveJsonPtr;
    engine.resolveJsonPtr = path => {
      const weights = /^\/nodes\/(\d+)\/weights\/(\d+)$/.exec(path);
      const translation = /^\/nodes\/(\d+)\/translation$/.exec(path);
      if (!weights && !translation) return base(path);
      const node = compiled.asset.doc.nodes[Number((weights ?? translation)[1])];
      return {
        typeName: weights ? "float" : "float3", readOnly: false,
        getValue: () => weights ? [node.weights[Number(weights[2])]] : node.translation,
        setValue: (_, value) => {
          if (weights) node.weights[Number(weights[2])] = Array.isArray(value) ? value[0] : value;
          else node.translation = value;
        },
      };
    };
  });
  return { ...r, compiled,
    tick(seconds = 1 / 60) { time += seconds * 1000; r.engine.executeEventQueueTick(); },
    send(id, detail = {}) { r.bus.dispatchCustomEvent("KHR_INTERACTIVITY:" + id, detail); },
    global(name) { return r.value("JS global " + name)[0]; },
    status(name) { return r.engine.variables[compiled.metadata.cooperative[name]].value[0]; },
    finish(max = 3000) {
      let ticks = 0;
      while (r.engine.variables[compiled.metadata.vars.pc].value[0] >= 0 && ticks++ < max) {
        this.tick();
        assert.ok(this.status("used") <= this.status("limit"));
      }
      assert.ok(ticks < max, "scheduler must terminate");
      assert.equal(r.engine.variables[compiled.metadata.vars.fault].value[0], false);
      return ticks;
    },
  };
}

test("awaited helpers return numeric results, nest and recurse with one-step slicing", () => {
  const source = `var result=0;
    async function fib(n){if(n<2)return n;return await fib(n-1)+await fib(n-2);}
    function combine(a,b){return a*10+b;}
    async function main(){result=combine(await fib(5),await fib(4));}`;
  for (const optimize of [false, true]) {
    const r = load(source, { optimize, cooperative: { stepsPerTick: 1 }, maxDepth: 8 });
    try {
      assert.equal(r.global("result"), 0);
      assert.ok(r.finish() > 10);
      assert.equal(r.global("result"), 53);
      assert.ok(r.compiled.graph.declarations.every(d => !d.extension));
      assert.ok(!r.compiled.graph.nodes.some(n => n.extras?.scriptAwait));
      assert.ok(!r.compiled.graph.nodes.some(n => r.compiled.graph.declarations[n.declaration].op === "flow/setDelay"));
    } finally { r.dispose(); }
  }
});

test("nextFrame and sleep(0) always suspend until a strictly later tick", () => {
  const r = load(`var phase=0;async function main(){phase=1;await tasks.nextFrame();phase=2;await tasks.sleep(0);phase=3;}`);
  try {
    assert.equal(r.global("phase"), 1);
    r.tick(0);
    assert.equal(r.global("phase"), 2);
    r.tick(0);
    assert.equal(r.global("phase"), 3);
  } finally { r.dispose(); }
});

test("sleep uses timeline seconds, and first tick's NaN delta cannot poison it", () => {
  const r = load(`var phase=0;async function main(){phase=1;await tasks.sleep(.25);phase=2;}`);
  try {
    r.tick(.125); assert.equal(r.global("phase"), 1);
    r.tick(.125); assert.equal(r.global("phase"), 2);
    assert.ok(Number.isFinite(r.status("deadline")));
  } finally { r.dispose(); }
});

test("invalid sleeps settle in fault rather than leaving the callback parked", () => {
  for (const duration of ["-1", "0/0", "1/0"]) {
    const r = load(`var result=0;async function main(){await tasks.sleep(${duration});result=1;}`);
    try {
      assert.equal(r.global("result"), 0);
      assert.equal(r.engine.variables[r.compiled.metadata.vars.fault].value[0], true);
      assert.equal(r.engine.variables[r.compiled.metadata.vars.pc].value[0], -1);
      assert.equal(r.status("waiting"), false);
    } finally { r.dispose(); }
  }
});

test("mutable operands evaluated before suspension are snapshots, including scene and heap", () => {
  const source = `var v=7, arr=[11], result=0, frames=0;
    async function helper(){await tasks.nextFrame();return 3;}
    async function main(){result=v+arr[0]+scene.getTranslationX(0)+await helper();}
    function frame(time){frames++;if(frames>1){v=70;arr[0]=110;scene.setTranslation(0,50,0,0);}}
    events.onStart(main);events.onFrame(frame);`;
  for (const optimize of [false, true]) {
    const r = load(source, { optimize, scene: { asset: { version: "2.0" }, nodes: [{ translation: [5,0,0] }] } });
    try { r.finish(); assert.equal(r.global("result"), 26); }
    finally { r.dispose(); }
  }
});

test("suspending loops preserve break, continue, return and refreshed globals", () => {
  const source = `var v=1,result=0,frames=0;
    function frame(time){frames++;v=frames;}
    async function helper(){var sum=0;for(var j=0;j<3;j++){for(var i=0;i<5;i++){
      if(i==1)continue;if(i==4)break;sum+=v*8;await tasks.nextFrame();
    }}return sum;}
    async function main(){result=await helper();}
    events.onStart(main);events.onFrame(frame);`;
  for (const optimize of [false, true]) {
    const r = load(source, { optimize, cooperative: { stepsPerTick: 1 } });
    try { r.finish(); assert.ok(r.global("result") > 9*8); }
    finally { r.dispose(); }
  }
});

test("short-circuit awaits remain lazy; already returned helpers still suspend", () => {
  const r = load(`var calls=0,result=0;async function helper(){calls++;return 9;}
    async function main(){var a=0&&await helper();var b=1||await helper();result=a+b+await helper();}`);
  try {
    assert.equal(r.global("calls"), 1);
    assert.equal(r.global("result"), 0);
    r.tick(); assert.equal(r.global("result"), 10);
  } finally { r.dispose(); }
});

test("interrupt cancels sleeping work and queued jobs; reusing the await site is safe", () => {
  const r = load(`var result=0,frames=0,hover=0;
    async function go(n){await tasks.sleep(.25);result=n;}
    function frame(time){frames++;}function enter(){hover++;}
    events.onReceive('go',go,['int'],{interrupt:true});events.onFrame(frame);
    events.onReceive('hover',enter,[],{immediate:true});`);
  try {
    r.send("go", {n:1}); r.tick();
    r.send("hover"); r.tick(.125); assert.equal(r.global("hover"), 1);
    r.send("go", {n:2}); r.tick(0);
    r.tick(.125); assert.equal(r.global("result"), 0); // old deadline
    r.tick(.125); assert.equal(r.global("result"), 2);
    assert.equal(r.status("stackDepth"), 0);
    assert.ok(r.global("frames") >= 6);
    assert.deepEqual(Object.keys(r.bus.variables), []);
    assert.deepEqual(Object.keys(r.bus.pointers), []);
    assert.ok(!r.compiled.graph.nodes.some(n => r.compiled.graph.declarations[n.declaration].op === "flow/setDelay"));
  } finally { r.dispose(); }
});

test("normal callbacks retain FIFO ordering while a callback awaits", () => {
  const r = load(`var result=0;async function go(n){await tasks.nextFrame();result=result*10+n;}
    events.onReceive('go',go,['int']);`);
  try {
    r.send("go", {n:1});r.send("go", {n:2});r.tick();
    assert.equal(r.global("result"), 0);
    for (let i=0;i<8;i++) r.tick();
    assert.equal(r.global("result"), 12);
  } finally { r.dispose(); }
});

test("launches and interrupts spend one central tick budget rather than refilling it", () => {
  const r = load(`var count=0;async function go(){for(var i=0;i<20;i++)count++;}
    events.onReceive('go',go,[],{interrupt:true});`, { cooperative: {stepsPerTick:1} });
  try {
    for (let tick=0;tick<10;tick++) {
      const before=r.global("count");
      for(let j=0;j<5;j++)r.send("go");
      r.tick();
      assert.ok(r.global("count")-before<=1);
      assert.ok(r.status("used")<=1);
    }
    r.finish();
  } finally { r.dispose(); }
});

test("unsupported promise/concurrency/animation semantics have explicit diagnostics", () => {
  for (const source of [
    `async function helper(){return 1;}async function main(){helper();}`,
    `async function main(){tasks.sleep(1);}`,
    `async function main(){await scene.interpolateTranslation(0,1,0,0,.2);}`,
    `async function main(){await Promise.all([]);}`,
    `async function frame(time){await tasks.nextFrame();}events.onFrame(frame);`,
    `function helper(){var a=[1];return a[0];}async function main(){helper();await tasks.nextFrame();}function frame(time){helper();}events.onStart(main);events.onFrame(frame);`,
  ]) assert.throws(() => compile(source), /await|async|synchronous|numeric|Mutable local arrays/i);
  assert.throws(() => new VM(compileIR(`async function main(){await tasks.nextFrame();}`)).run("main"), /synchronous reference VM/);
});

test("indexed assignment snapshots its address and old compound value before awaiting", () => {
  for (const optimize of [false, true]) for (const assignment of ["=", "+="]) {
    const r = load(`var arr=[10,20],index=0,result=0,frames=0;
      async function helper(){await tasks.nextFrame();return 7;}
      async function main(){arr[index]${assignment}await helper();result=arr[0]*100+arr[1];}
      function frame(time){frames++;if(frames>1){index=1;arr[0]=30;}}
      events.onStart(main);events.onFrame(frame);`, { optimize });
    try { r.finish();assert.equal(r.global("result"), assignment==="="?720:1720); }
    finally { r.dispose(); }
  }
});
