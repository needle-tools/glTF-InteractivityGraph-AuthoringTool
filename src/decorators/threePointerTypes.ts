export type ThreePointerBinder = (
    path: string,
    typeName: string,
    get: () => unknown,
    set?: (value: unknown) => void,
    readOnly?: boolean,
) => void;
