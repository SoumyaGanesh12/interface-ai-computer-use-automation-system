/** The one place that decides where a run's evidence lives, so nothing computes it independently and drifts. */
import path from 'node:path';

export function runEvidenceDir(runId: string, root = 'evidence'): string {
  return path.join(root, runId);
}
