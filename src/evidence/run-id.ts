/**
 * `<capabilityId>-<timestamp>`, not a raw UUID -- stays readable in a directory listing.
 * Every place a run gets kicked off (a test harness, the replay CLI, later the
 * discovery CLI) should generate its runId through this, not a literal string: a
 * runId that isn't actually unique per invocation is how two runs end up silently
 * appended into the same evidence file.
 */
export function generateRunId(capabilityId: string): string {
  return `${capabilityId}-${Date.now()}`;
}
