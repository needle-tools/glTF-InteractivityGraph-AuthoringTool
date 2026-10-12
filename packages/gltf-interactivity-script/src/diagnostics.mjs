export class CompileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CompileError";
    this.diagnostic = { code, message, ...details };
  }
}
export function diagnostic(error, sourceName, source) {
  if (error instanceof CompileError)
    return {
      ...error.diagnostic,
      ...(sourceName ? { source: sourceName } : {}),
    };
  const match = / at (\d+):(\d+)\s*$/.exec(error.message),
    loc =
      error.loc ??
      (match
        ? { line: Number(match[1]), column: Number(match[2]) - 1 }
        : undefined);
  return {
    code:
      error.code && typeof error.code === "string"
        ? "IGS_IO"
        : error.message.startsWith("Invalid KHR_interactivity")
          ? "IGS_GRAPH_SCHEMA"
          : "IGS_SOURCE",
    message: error.message,
    ...(sourceName ? { source: sourceName } : {}),
    ...(loc
      ? {
          range: { start: { line: loc.line, column: loc.column + 1 } },
          line: source?.split("\n")[loc.line - 1],
        }
      : {}),
  };
}
export function fail(code, message, details) {
  throw new CompileError(code, message, details);
}
