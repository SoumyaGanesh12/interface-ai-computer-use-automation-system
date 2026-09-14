/**
 * The write boundary: whatever the evidence/audit writer touches passes through this,
 * unconditionally -- not a helper a caller must remember to invoke before writing.
 *
 * Credentials never reach here at all: typeCredential resolves inside the surface
 * adapter and never returns a value, so there is nothing for this to redact on that
 * front. What this actually guards is an artifact's own declared-sensitive inputs
 * (`redact: true`) showing up verbatim in a run log.
 */
const PLACEHOLDER = '[redacted]';

export interface InputDeclaration {
  name: string;
  redact: boolean;
}

export function redactInputs(inputs: Readonly<Record<string, string>>, declarations: readonly InputDeclaration[]): Record<string, string> {
  const redactedNames = new Set(declarations.filter((d) => d.redact).map((d) => d.name));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    out[key] = redactedNames.has(key) ? PLACEHOLDER : value;
  }
  return out;
}

/** Same masking rule as redactInputs, applied to a run's extracted outputs before they reach a durable log -- the value returned to the caller is never touched, only what gets persisted. */
export function redactOutputs(outputs: Readonly<Record<string, unknown>>, declarations: readonly InputDeclaration[]): Record<string, unknown> {
  const redactedNames = new Set(declarations.filter((d) => d.redact).map((d) => d.name));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(outputs)) {
    out[key] = redactedNames.has(key) ? PLACEHOLDER : value;
  }
  return out;
}
