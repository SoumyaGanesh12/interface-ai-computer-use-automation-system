/**
 * The full validation pipeline for a loaded artifact: schema version, then shape, then
 * matcher overlap. Each stage is checked in order so a version mismatch always produces
 * a clear rejection, never a confusing shape-validation error against a format the
 * engine was never meant to parse.
 */
import * as z from 'zod';
import { ArtifactSchema, type Artifact } from './artifact';
import { findOverlaps, type LabeledMatcher } from './overlap';

const SUPPORTED_ARTIFACT_SCHEMA_VERSION = 1;

export type ValidateResult = { ok: true; artifact: Artifact } | { ok: false; reason: string };

export function validateArtifact(raw: unknown): ValidateResult {
  if (typeof raw !== 'object' || raw === null || !('artifactSchemaVersion' in raw)) {
    return { ok: false, reason: 'missing artifactSchemaVersion' };
  }
  const version = (raw as { artifactSchemaVersion: unknown }).artifactSchemaVersion;
  if (version !== SUPPORTED_ARTIFACT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported artifact schema version ${String(version)}, this engine supports ${SUPPORTED_ARTIFACT_SCHEMA_VERSION}`,
    };
  }

  const parsed = ArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: z.prettifyError(parsed.error) };
  }

  const entries: LabeledMatcher[] = [
    ...parsed.data.recovery.map((r) => ({ label: `recovery:${r.code}`, matcher: r.detect })),
    ...parsed.data.outcomes.map((o) => ({ label: `outcome:${o.code}`, matcher: o.detect })),
    ...parsed.data.steps.filter((s) => s.precheck).map((s) => ({ label: `precheck:${s.id}`, matcher: s.precheck!.detect })),
  ];
  const overlaps = findOverlaps(entries);
  if (overlaps.length > 0) return { ok: false, reason: overlaps.join('; ') };

  return { ok: true, artifact: parsed.data };
}
