export type DebugDetails = Record<string, unknown>;

export function debug(event: string, details: DebugDetails = {}): void {
  console.info("[ContextWordHelper]", {
    event,
    elapsedMs: Math.round(performance.now()),
    ...details,
  });
}
