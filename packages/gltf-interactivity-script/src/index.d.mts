import type { NativeOps } from "./ops.mjs";
export { catalog, signatures } from "./catalog.mjs";
export type { NativeOps } from "./ops.mjs";
export type Signature =
  | "bool"
  | "int"
  | "float"
  | "float2"
  | "float3"
  | "float4"
  | "float2x2"
  | "float3x3"
  | "float4x4"
  | "ref";
export interface Value<T extends Signature> {
  readonly type: T;
  readonly edge: Readonly<{
    type: number;
    node?: number;
    socket?: string;
    value?: readonly (number | boolean | string)[];
  }>;
  readonly owner: GraphBuilder;
}
export interface Variable<T extends Signature> {
  readonly id: number;
  readonly name: string;
  readonly type: T;
  readonly owner: GraphBuilder;
}
export interface GraphEvent<T extends Record<string, Signature>> {
  readonly id: number;
  readonly values: T;
  readonly owner: GraphBuilder;
}
export interface NodeOptions {
  label?: string;
  outputTypes?: Record<string, Signature>;
}
export interface GraphNode<
  O extends Record<string, Signature> = Record<string, Signature>,
  I extends string = string,
  F extends string = string,
> {
  readonly id: number;
  readonly op: string;
  readonly owner: GraphBuilder;
  readonly label?: string;
  readonly outputs: { readonly [K in keyof O]: Value<O[K]> };
  flow(...args: "out" extends F ? [socket?: F] : [socket: F]): Flow;
}
export interface Flow {
  to<O extends Record<string, Signature>, I extends string, F extends string>(
    target: GraphNode<O, I, F>,
    ...args: "in" extends I ? [input?: I] : [input: I]
  ): GraphNode<O, I, F>;
}
export interface RawGraph {
  name?: string;
  types: { signature: Signature }[];
  variables?: {
    name?: string;
    type: number;
    value?: (number | string | boolean)[];
  }[];
  declarations: {
    op: string;
    extension?: string;
    inputValueSockets?: Record<string, { type: number }>;
    outputValueSockets?: Record<string, { type: number }>;
  }[];
  events?: { id?: string; values?: Record<string, { type: number }> }[];
  nodes: {
    declaration: number;
    extras?: Record<string, unknown>;
    values?: Record<
      string,
      {
        node?: number;
        socket?: string;
        type?: number;
        value?: (number | string | boolean)[];
      }
    >;
    configuration?: Record<string, { value: (number | string | boolean)[] }>;
    flows?: Record<string, { node: number; socket: string }>;
  }[];
}
export interface GltfDocument {
  asset: { version: string; generator?: string };
  nodes?: { name?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}
export interface CompileOptions {
  scene?: Asset | GltfDocument;
  entry?: string;
  sourceName?: string;
  maxDepth?: number;
  arrayCapacity?: number;
  optimize?: boolean;
}
export interface CompileResult {
  graph: RawGraph;
  asset: Asset;
  metadata?: Record<string, unknown>;
  statistics: {
    nodes: number;
    variables: number;
    heapCells: number;
    functionContexts?: number;
  };
  toGLB(): Uint8Array;
}
export interface Diagnostic {
  code: string;
  message: string;
  source?: string;
  range?: { start: { line: number; column: number } };
  operation?: string;
  socket?: string;
  expected?: unknown;
  actual?: unknown;
}
export class CompileError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(
    code: string,
    message: string,
    details?: Omit<Diagnostic, "code" | "message">,
  );
}
export function diagnostic(
  error: Error,
  sourceName?: string,
  source?: string,
): Diagnostic;
export class Asset {
  doc: GltfDocument;
  constructor();
  static fromGLB(bytes: Uint8Array): Asset;
  static fromDocument(document: GltfDocument): Asset;
  pack(): Uint8Array;
  ram(values: readonly number[]): number;
}
export class GraphBuilder {
  readonly ops: NativeOps;
  constructor(options?: { name?: string; optimize?: boolean });
  literal<T extends Signature>(
    type: T,
    value: T extends "bool"
      ? boolean
      : T extends "ref"
        ? string
        : number | readonly number[],
  ): Value<T>;
  float(value: number): Value<"float">;
  int(value: number): Value<"int">;
  bool(value: boolean): Value<"bool">;
  ref(value: string): Value<"ref">;
  float2(value: readonly [number, number]): Value<"float2">;
  float3(value: readonly [number, number, number]): Value<"float3">;
  float4(value: readonly [number, number, number, number]): Value<"float4">;
  float2x2(value: readonly [number, number, number, number]): Value<"float2x2">;
  float3x3(
    value: readonly [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  ): Value<"float3x3">;
  float4x4(
    value: readonly [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  ): Value<"float4x4">;
  variable<T extends Signature>(
    name: string,
    type: T,
    initial?: T extends "bool"
      ? boolean
      : T extends "ref"
        ? string
        : number | readonly number[],
  ): Variable<T>;
  get<T extends Signature>(variable: Variable<T>): Value<T>;
  set<T extends Signature>(
    variable: Variable<T>,
    value: Value<NoInfer<T>>,
  ): GraphNode<{}, "in", "out">;
  event<T extends Record<string, Signature>>(
    id: string,
    values?: T,
  ): GraphEvent<T>;
  receive<T extends Record<string, Signature>>(
    event: GraphEvent<T>,
  ): GraphNode<T, never, "out">;
  send<T extends Record<string, Signature>>(
    event: GraphEvent<T>,
    values: { [K in keyof T]: Value<T[K]> },
  ): GraphNode<{}, "in", "out">;
  pointer<T extends Signature>(
    type: T,
    path: string,
    parameters?: Record<string, Value<"int" | "ref">>,
  ): Value<T>;
  write<T extends Signature>(
    type: T,
    path: string,
    value: Value<NoInfer<T>>,
    parameters?: Record<string, Value<"int" | "ref">>,
  ): GraphNode<{}, "in", "out" | "err">;
  node(
    op: string,
    inputs?: Record<string, Value<Signature>>,
    configuration?: Record<
      string,
      number | boolean | string | readonly number[]
    >,
    options?: NodeOptions,
  ): GraphNode;
  connect(
    from: GraphNode,
    output: string,
    to: GraphNode,
    input?: string,
  ): GraphNode;
  sequence(...actions: GraphNode[]): GraphNode<{}, "in", string>;
  finish(): RawGraph;
}
export interface GraphAuthorContext {
  g: GraphBuilder;
  scene: GltfDocument;
  node(name: string): number;
}
export type GraphAuthor = (context: GraphAuthorContext) => void | Promise<void>;
export function defineGraph(author: GraphAuthor): GraphAuthor;
export function compile(
  source: string,
  options?: CompileOptions,
): CompileResult;
export function compileGraph(
  author: GraphAuthor,
  options?: CompileOptions & { name?: string; optimize?: boolean },
): Promise<CompileResult>;
export function attachGraph(
  asset: Asset,
  graph: RawGraph,
  options?: { metadata?: Record<string, unknown>; heap?: readonly number[] },
): Asset;
