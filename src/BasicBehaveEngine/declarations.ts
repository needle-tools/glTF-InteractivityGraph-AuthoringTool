import { OPERATION_SCHEMAS } from "./generated/interactivitySchemas";
import type { IInteractivityDeclaration, IInteractivityValueType } from "./types/InteractivityGraph";

/** Declaration equality excludes output sockets and ignores input property order. */
export function declarationKey(declaration: IInteractivityDeclaration): string {
    return JSON.stringify([
        declaration.op,
        declaration.extension ?? null,
        Object.entries(declaration.inputValueSockets ?? {})
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([id, socket]) => [id, socket.type]),
    ]);
}

/** Explicit interface for a registered vendor operation; types are primitive signature names. */
export interface BehaviourNodeSignature {
    extension: string;
    inputValueSockets?: Record<string, string>;
    outputValueSockets?: Record<string, string>;
}

interface SocketDefinition { types: readonly string[]; group?: string }
interface OperationDefinition {
    extension?: string;
    inputs: Record<string, SocketDefinition>;
    outputs: Record<string, SocketDefinition>;
}

function matchesInterface(
    declaration: IInteractivityDeclaration,
    types: readonly IInteractivityValueType[],
    definition: OperationDefinition,
): boolean {
    const groups = new Map<string, string>();
    for (const [actual, expected] of [
        [declaration.inputValueSockets ?? {}, definition.inputs],
        [declaration.outputValueSockets ?? {}, definition.outputs],
    ] as const) {
        if (Object.keys(actual).length !== Object.keys(expected).length) return false;
        for (const [id, socket] of Object.entries(expected)) {
            const type = types[actual[id]?.type];
            if (!type || type.signature === "custom" || !socket.types.includes(type.signature)) return false;
            // Built-in interfaces use primitive types; an arbitrary custom type is not one.
            if (socket.group) {
                if (groups.has(socket.group) && groups.get(socket.group) !== type.signature) return false;
                groups.set(socket.group, type.signature);
            }
        }
    }
    return true;
}

export function supportsDeclaration(
    declaration: IInteractivityDeclaration,
    types: readonly IInteractivityValueType[],
    registered?: readonly BehaviourNodeSignature[],
): boolean {
    if (declaration.extension === undefined) {
        const definition: OperationDefinition | undefined = OPERATION_SCHEMAS[declaration.op];
        return definition !== undefined && definition.extension === undefined;
    }
    if (registered) return registered.some(signature =>
        signature.extension === declaration.extension && matchesInterface(declaration, types, {
            inputs: Object.fromEntries(Object.entries(signature.inputValueSockets ?? {}).map(([id, type]) => [id, { types: [type] }])),
            outputs: Object.fromEntries(Object.entries(signature.outputValueSockets ?? {}).map(([id, type]) => [id, { types: [type] }])),
        }),
    );
    const definition: OperationDefinition | undefined = OPERATION_SCHEMAS[declaration.op];
    return definition?.extension === declaration.extension && definition !== undefined
        && matchesInterface(declaration, types, definition);
}
