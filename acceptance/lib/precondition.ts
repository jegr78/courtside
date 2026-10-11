export function precondition(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`PRECONDITION: ${what}`);
}
