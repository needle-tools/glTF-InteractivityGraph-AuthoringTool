import { BasicBehaveEngine } from "@khronosgroup/gltf-interactivity-engine";
class Bus {
  constructor() {
    this.queue = [];
    this.listeners = new Map();
    this.variables = {};
    this.pointers = {};
  }
  getEventList = () => this.queue;
  clearEventList = () => {
    this.queue = [];
  };
  addEvent = (event) => {
    this.queue.push(event);
  };
  addCustomEventListener = (id, fn) => {
    const list = this.listeners.get(id) ?? [];
    list.push(fn);
    this.listeners.set(id, list);
  };
  clearCustomEventListeners = () => this.listeners.clear();
  dispatchCustomEvent = (id, detail) => {
    for (const fn of this.listeners.get(id) ?? [])
      this.addEvent({ func: () => fn({ type: id, detail }), inSocketId: id });
  };
  getCustomEventsNames = () => [...this.listeners.keys()];
  setVariableInterpolationCallback = (id, a) => {
    this.variables[id] = a;
  };
  getVariableInterpolationCallbacks = () => this.variables;
  clearVariableInterpolation = (id) => {
    delete this.variables[id];
  };
  setPointerInterpolationCallback = (id, a) => {
    this.pointers[id] = a;
  };
  getPointerInterpolationCallbacks = () => this.pointers;
  clearPointerInterpolation = (id) => {
    delete this.pointers[id];
  };
}
export function runGraph(graph) {
  const bus = new Bus(),
    engine = new BasicBehaveEngine(60, bus);
  engine.loadBehaveGraph(graph, false);
  engine.executeEventQueueTick();
  return {
    engine,
    bus,
    value: (name) => engine.variables.find((v) => v.name === name).value,
    dispose: () => engine.dispose(),
  };
}
