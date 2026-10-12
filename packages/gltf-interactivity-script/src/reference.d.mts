import type { RawGraph, GltfDocument, Signature } from "./index.mjs";
export interface Program {
  version: number;
  code: number[][];
  data: number[];
  globals: Record<string, number>;
  functions: Record<
    string,
    {
      entry: number;
      params: string[];
      locals: Record<string, number>;
      calls: string[];
    }
  >;
  frameSize: number;
  bindings: readonly object[];
}
export const OPS: Readonly<Record<string, number>>;
export function compile(
  source: string,
  options?: { arrayCapacity?: number; scene?: GltfDocument },
): Program;
export class VM {
  constructor(
    program: Program,
    options?: {
      seed?: number;
      maxDepth?: number;
      scene?: {
        get(path: string, indices: number[]): number | boolean | number[];
        set(
          path: string,
          indices: number[],
          value: number | boolean | number[],
        ): void;
      };
    },
  );
  readonly sentEvents: { id: string; values: Record<string, number> }[];
  global(name: string): number;
  array(name: string, length?: number): number[];
  run(name: string, args?: number[], limit?: number): number;
}
export interface Kernel {
  g: Graph;
  vars: Record<string, number>;
  globals: Record<string, number>;
  initial: number[];
  heapNodeBase: number;
  variableMemory: boolean;
  instances?: ReadonlyMap<string, object>;
  memorySize: number;
  program: Program;
  memory(address: Edge): Edge;
  writeMemory(address: Edge, value: Edge): number;
}
export function lowerStructured(
  program: Program,
  options?: { heapNodeBase?: number; maxDepth?: number; optimize?: boolean },
): StructuredKernel;
export function lowerStructuredProgram(
  program: Program,
  options?: {
    heapNodeBase?: number;
    maxDepth?: number;
    entry?: string;
    cooperative?: { stepsPerTick?: number; stackCapacity?: number };
    optimize?: boolean;
  },
): StructuredKernel;
export interface Edge {
  type: number;
  node?: number;
  socket?: string;
  value?: (number | boolean | string)[];
}
export interface StructuredKernel extends Kernel {
  prepare(name: string, values?: Edge[]): number;
  finish(): Record<number, number>;
  structured: true;
  instances: ReadonlyMap<string, object>;
}
export class Graph {
  graph: RawGraph;
  constructor(name: string);
  literal(
    type: Signature,
    value: number | boolean | string | readonly (number | boolean | string)[],
  ): Edge;
  type(name: Signature): number;
  node(
    op: string,
    values?: Record<string, Edge>,
    configuration?: Record<
      string,
      number | boolean | string | readonly (number | boolean | string)[]
    >,
    extension?: string,
  ): number;
  output(node: number, type: Signature, socket?: string): Edge;
  data(
    op: string,
    type: Signature,
    values?: Record<string, Edge>,
    configuration?: Record<
      string,
      number | boolean | string | readonly (number | boolean | string)[]
    >,
    socket?: string,
  ): Edge;
  math(op: string, type: Signature, ...args: Edge[]): Edge;
  select(
    condition: Edge,
    whenFalse: Edge,
    whenTrue: Edge,
    type: Signature,
  ): Edge;
  variable(
    name: string,
    type: Signature,
    value: number | boolean | string | readonly (number | boolean | string)[],
  ): number;
  get(id: number): Edge;
  set(values: Record<number, Edge>): number;
  pointer(path: string, type: Signature, values?: Record<string, Edge>): Edge;
  write(
    path: string,
    type: Signature,
    value: Edge,
    values?: Record<string, Edge>,
  ): number;
  link(
    from: number,
    to: number | undefined,
    socket?: string,
  ): number | undefined;
  chain(...nodes: number[]): number | undefined;
  extract(a: Edge, type: Signature, index: number): Edge;
  vec3(a: Edge, b: Edge, c: Edge): Edge;
  vec4(a: Edge, b: Edge, c: Edge, d: Edge): Edge;
  convert(a: Edge, from: Signature, to: Signature): Edge;
  compactSequences(): void;
  fuseVariableWrites(): void;
  eliminateDeadStores(keep: readonly number[]): boolean;
  pruneVariables(keep: readonly number[]): Map<number, number>;
  pruneNodes(): Map<number, number>;
  pruneTypes(): void;
  orderFlows(): Record<number, number>;
}
