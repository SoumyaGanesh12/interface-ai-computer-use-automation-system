/**
 * Observation fingerprint for no-progress detection.
 *
 * Covers (role, name, value, enabled, visible, framePath), sorted before hashing so
 * reordering the same rows reads as no progress. Deliberately excludes:
 *   - bounds: sub-pixel jitter would make every hash unique, so the check never fires
 *   - nodeId: regenerated per observation, always different by construction
 *   - textContext, capturedAt: derived/always-changing, add noise not signal
 * `value` is included on purpose -- typing into a field is progress.
 */
import { createHash } from 'node:crypto';
import type { ObservedNode } from './observation';

export function observationHash(nodes: readonly ObservedNode[]): string {
  const rows = nodes
    .map((n) =>
      JSON.stringify([n.role, n.name, n.value ?? '', n.enabled, n.visible, n.framePath.join(' ')]),
    )
    .sort();

  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}
