import { BasicBehaveEngine } from "../src/BasicBehaveEngine/BasicBehaveEngine";
import { BehaveEngineNode } from "../src/BasicBehaveEngine/BehaveEngineNode";
import { validateInteractivityGraph } from "../src/BasicBehaveEngine/validateInteractivity";
import { TestEventBus } from "./assets/sampleAssetHarness";

const types = ["bool", "int", "float3", "ref"].map(signature => ({ signature }));
const outputs = { selectedNode: { type: 3 }, controllerIndex: { type: 1 },
    selectionPoint: { type: 2 }, selectionRayOrigin: { type: 2 }, event: { type: 3 } };

test("selection dispatch requires the exact extension and complete interface", () => {
    for (const [extension, declared, expected] of [
        ["KHR_node_selectability", outputs, true],
        ["VND_unsupported", outputs, false],
        ["", outputs, false],
        ["KHR_node_selectability", undefined, false],
        ["KHR_node_selectability", { selectionPoint: { type: 2 } }, false],
        ["KHR_node_selectability", { ...outputs, controllerIndex: { type: 0 } }, false],
    ] as const) {
        const graph = { types, variables: [{ type: 0, value: [false] }], declarations: [
            { op: "event/onSelect", extension, ...(declared ? { outputValueSockets: declared } : {}) },
            { op: "variable/set" },
        ], nodes: [
            { declaration: 0, configuration: { nodeIndex: { value: [0] } }, flows: { out: { node: 1, socket: "in" } } },
            { declaration: 1, configuration: { variables: { value: [0] } }, values: { "0": { type: 0, value: [true] } } },
        ] };
        validateInteractivityGraph(graph);
        const engine = new BasicBehaveEngine(60, new TestEventBus());
        try {
            engine.loadBehaveGraph(graph, false);
            engine.select(0, 0, [1, 2, 3], [0, 0, 0]);
            engine.executeEventQueueTick();
            expect(engine.variables[0].value).toEqual([expected]);
            expect(engine.selectableNodesIndices.size).toBe(expected ? 1 : 0);
        } finally { engine.dispose(); }
    }
});

test("unsupported data nodes retain declared defaults without executing core namesakes", () => {
    const engine = new BasicBehaveEngine(60, new TestEventBus());
    const graph = { types: [{ signature: "float" }], variables: [{ type: 0, value: [99] }],
        declarations: [{ op: "math/Pi", extension: "", outputValueSockets: { value: { type: 0 } } },
            { op: "event/onStart" }, { op: "variable/set" }], nodes: [
            { declaration: 0 }, { declaration: 1, flows: { out: { node: 2, socket: "in" } } },
            { declaration: 2, configuration: { variables: { value: [0] } }, values: { "0": { node: 0, socket: "value" } } },
        ] };
    validateInteractivityGraph(graph);
    try { engine.loadBehaveGraph(graph, false); engine.executeEventQueueTick(); expect(engine.variables[0].value?.[0]).toBeNaN(); }
    finally { engine.dispose(); }
});

test("declaration identity includes sorted input IDs/types, excludes outputs, and preserves absent extension", () => {
    const make = (input: number, output = input) => ({ op: "math/vendor", extension: "VND_test",
        inputValueSockets: { a: { type: input }, b: { type: input } }, outputValueSockets: { value: { type: output } } });
    const base = { types: [{ signature: "int" }, { signature: "float" },
        { signature: "custom", extensions: { VND_first: {} } }, { signature: "custom", extensions: { VND_second: {} } }] };
    expect(() => validateInteractivityGraph({ ...base, declarations: [make(0), make(1)] })).not.toThrow();
    expect(() => validateInteractivityGraph({ ...base, declarations: [make(2), make(3)] })).not.toThrow();
    expect(() => validateInteractivityGraph({ ...base, declarations: [make(0), make(0, 1)] })).toThrow("duplicate declarations");
    const reordered = { ...make(0), inputValueSockets: { b: { type: 0 }, a: { type: 0 } } };
    expect(() => validateInteractivityGraph({ ...base, declarations: [make(0), reordered] })).toThrow("duplicate declarations");
    expect(() => validateInteractivityGraph({ declarations: [{ op: "math/Pi" }, { op: "math/Pi", extension: "" }] })).not.toThrow();
});

test("vendor registrations declare explicit primitive interfaces and support input variants", () => {
    class Vendor extends BehaveEngineNode {
        override processNode() { return { value: { type: this.values.a.type!, value: this.values.a.value } }; }
    }
    for (const supported of [false, true]) for (const type of [0, 1]) {
        const engine = new BasicBehaveEngine(60, new TestEventBus());
        engine.registerBehaveEngineNode("math/vendor", Vendor, supported ? [
            { extension: "VND_test", inputValueSockets: { a: "int" }, outputValueSockets: { value: "int" } },
            { extension: "VND_test", inputValueSockets: { a: "float" }, outputValueSockets: { value: "float" } },
        ] : undefined);
        const graph = { types: [{ signature: "int" }, { signature: "float" }], variables: [{ type, value: [99] }],
            declarations: [{ op: "math/vendor", extension: "VND_test", inputValueSockets: { a: { type } }, outputValueSockets: { value: { type } } },
                { op: "event/onStart" }, { op: "variable/set" }], nodes: [
                { declaration: 0, values: { a: { type, value: [7] } } },
                { declaration: 1, flows: { out: { node: 2, socket: "in" } } },
                { declaration: 2, configuration: { variables: { value: [0] } }, values: { "0": { node: 0, socket: "value" } } },
            ] };
        validateInteractivityGraph(graph);
        try {
            engine.loadBehaveGraph(graph, false); engine.executeEventQueueTick();
            if (supported) expect(engine.variables[0].value).toEqual([7]);
            else if (type === 0) expect(engine.variables[0].value).toEqual([0]);
            else expect(engine.variables[0].value?.[0]).toBeNaN();
        } finally { engine.dispose(); }
    }
});

test("disabled registered implementations remain no-ops without event subscriptions", () => {
    class DisabledEngine extends BasicBehaveEngine { disable(op: string) { this.registry.delete(op); } }
    const engine = new DisabledEngine(60, new TestEventBus());
    engine.disable("event/onSelect");
    const graph = { types, declarations: [{ op: "event/onSelect", extension: "KHR_node_selectability", outputValueSockets: outputs }], nodes: [{ declaration: 0, configuration: { nodeIndex: { value: [0] } } }] };
    validateInteractivityGraph(graph);
    try { engine.loadBehaveGraph(graph, false); expect(engine.selectableNodesIndices.size).toBe(0); }
    finally { engine.dispose(); }
});
