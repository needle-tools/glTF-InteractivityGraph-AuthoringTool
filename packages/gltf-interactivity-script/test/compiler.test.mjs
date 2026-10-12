import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/index.mjs";
import { compile as parse, VM } from "../src/reference.mjs";
import { runGraph } from "./runtime.mjs";
test("scalar primitive source uses native graph nodes and agrees with JavaScript math", () => {
  const source =
    "var result;function main(){var x=3;result=Math.sin(Math.PI/2)+Math.cos(0)+Math.sqrt(x*x)+math.clamp(8,0,2);}";
  const compiled = compile(source),
    r = runGraph(compiled.graph),
    vm = new VM(parse(source));
  try {
    vm.run("main");
    assert.deepEqual(r.value("JS global result"), [vm.global("result")]);
    assert.equal(vm.global("result"), 7);
  } finally {
    r.dispose();
  }
});
test("invariant arithmetic is evaluated outside loops without changing mutable operands", () => {
  const source =
    "var result;function main(){var n=9,a=3,sum=0;for(var j=0;j<n;j++){if(j==4)continue;sum+=(a*a+2)*j;}result=sum;}";
  const result = compile(source),
    r = runGraph(result.graph),
    vm = new VM(parse(source));
  try {
    vm.run("main");
    assert.deepEqual(r.value("JS global result"), [vm.global("result")]);
  } finally {
    r.dispose();
  }
});
test("exceptional global initializers survive packed JSON and execute as primitive operations", () => {
  const result = compile(
    "var x=-0,y=1/0,z=0/0,result;function main(){result=1/x;}",
  );
  const bytes = result.toGLB(),
    document = JSON.parse(
      Buffer.from(bytes)
        .subarray(20, 20 + Buffer.from(bytes).readUInt32LE(12))
        .toString(),
    );
  const r = runGraph(document.extensions.KHR_interactivity.graphs[0]);
  try {
    assert.ok(Object.is(r.value("JS global x")[0], -0));
    assert.equal(r.value("JS global y")[0], Infinity);
    assert.ok(Number.isNaN(r.value("JS global z")[0]));
    assert.equal(r.value("JS global result")[0], -Infinity);
  } finally {
    r.dispose();
  }
});

test("loop invariants preserve mutations from calls, nested loops and skipped bodies", () => {
  const sources = [
    "var n=2,result;function bump(){n++;return n;}function main(){var s=0;for(var i=0;i<4;i++){s+=n*n;bump();}result=s;}",
    "var result;function main(){var a=3,s=0;for(var i=0;i<4;i++){a++;for(var j=0;j<3;j++){s+=a*a+j;}}result=s;}",
    "var result;function main(){var a=0,s=0;for(var i=0;i<0;i++){s+=1/a;}for(i=0;i<8;i++){if(i==2)continue;if(i==6)break;s+=i*(4*4);}result=s;}",
  ];
  for (const source of sources) {
    const vm = new VM(parse(source));
    vm.run("main");
    for (const optimize of [false, true]) {
      const result = compile(source, { optimize }),
        r = runGraph(result.graph);
      try {
        assert.deepEqual(r.value("JS global result"), [vm.global("result")]);
      } finally {
        r.dispose();
      }
    }
  }
});
test("JavaScript rounding retains its tie rules while explicit primitive rounding follows the spec", () => {
  const result = compile(
      "var result,z,p;function main(){var x=-1.5;result=Math.round(x)*10+math.round(x);z=Math.round(-.2);p=Math.round(0);}",
    ),
    r = runGraph(result.graph);
  try {
    assert.deepEqual(r.value("JS global result"), [-12]);
    assert.ok(Object.is(r.value("JS global z")[0], -0));
    assert.ok(Object.is(r.value("JS global p")[0], 0));
  } finally {
    r.dispose();
  }
});

test("invalid resource bounds fail before lowering a recursive program", () => {
  assert.throws(
    () => compile("function main(){main();}", { maxDepth: Infinity }),
    (error) => error.diagnostic.code === "IGS_OPTION",
  );
  assert.throws(
    () => compile("function main(){}", { arrayCapacity: 0 }),
    (error) => error.diagnostic.code === "IGS_OPTION",
  );
});

test("whole quaternion scene writes agree between the core graph and IR oracle", () => {
  const source =
      'var player=scene.node("Player");function main(){var yaw=-Math.PI/2;scene.setRotation(player,0,Math.sin(yaw/2),0,Math.cos(yaw/2));}',
    scene = { asset: { version: "2.0" }, nodes: [{ name: "Player" }] },
    expected = [],
    actual = [];
  const vm = new VM(parse(source, { scene }), {
    scene: {
      set: (path, indices, value) => expected.push({ path, indices, value }),
    },
  });
  vm.run("main");
  const result = compile(source, { scene }),
    r = runGraph(result.graph, (engine) => {
      engine.resolveJsonPtr = () => ({typeName:"float4",readOnly:false,getValue:()=>[0,0,0,1],setValue:(path,value)=>actual.push({path,value})});
    });
  try {
    assert.equal(expected.length, 1);
    assert.equal(actual.length, 1);
    assert.equal(actual[0].path, "/nodes/0/rotation");
    assert.deepEqual(actual[0].value, expected[0].value);
    assert.equal(actual[0].value.length, 4);
  } finally {
    r.dispose();
  }
});

test("loop-local declarations are mutations when deciding which arithmetic is invariant", () => {
  const source = "var result=0;function main(){for(var j=0;j<32;j++){var cell=j*11;result+=Math.floor(cell/10)+cell%10;}}";
  const vm = new VM(parse(source)); vm.run("main");
  const compiled = compile(source), r = runGraph(compiled.graph);
  try { assert.deepEqual(r.value("JS global result"), [vm.global("result")]); }
  finally { r.dispose(); }
});
