import type {Signature} from "./index.mjs";
export interface OperationDescription { readonly description:string; readonly extension?:string; readonly inputs:Readonly<Record<string,{readonly types:readonly Signature[];readonly group?:string}>>; readonly outputs:Readonly<Record<string,{readonly types:readonly Signature[];readonly group?:string}>>; readonly flowInputs:readonly string[]; readonly flowOutputs:readonly string[]; readonly flags:readonly string[]; readonly configuration:Readonly<Record<string,{readonly type:string;readonly description:string;readonly default?:readonly unknown[]}>>; }
export const signatures: readonly Signature[];
export const catalog: Readonly<Record<string,OperationDescription>>;
