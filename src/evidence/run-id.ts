/**
 * `<capabilityId>-<timestamp>-<random>`, not a raw UUID -- stays readable in a directory
 * listing. Every place a run gets kicked off (a test harness, the replay CLI, later the
 * discovery CLI) should generate its runId through this, not a literal string: a runId
 * that isn't actually unique per invocation is how two runs end up silently appended
 * into the same evidence file.
 *
 * The timestamp alone is not enough: two calls made back-to-back (two concurrent
 * invocations of the same capability, exactly the multi-tenant case this exists for) land
 * in the same millisecond far more often than intuition suggests -- measured at 1000/1000
 * in a tight loop. The random suffix is what actually makes this collision-safe.
 */
export function generateRunId(capabilityId: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${capabilityId}-${Date.now()}-${random}`;
}
