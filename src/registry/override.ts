/**
 * Cross-tenant reuse: a base capability adapted for a different tenant's UI variant by
 * replacing the specific steps that differ, not by re-discovering the whole flow again.
 * An override provides a *complete* replacement Step for each id it touches, rather than
 * a partial field patch -- a step's target locator, its checkpoint, and its action are
 * one coherent unit, and merging them independently risks a checkpoint that no longer
 * matches what the (patched) action actually produced. Full replacement re-validates the
 * whole resulting artifact through the same validateArtifact every other artifact goes
 * through, so a broken override is a loud failure here, not a silent one at replay time.
 */
import * as z from 'zod';
import { StepSchema } from '../catalog/step';
import { validateArtifact } from '../catalog/validate';
import type { Artifact } from '../catalog/artifact';

export const TenantOverrideSchema = z.object({
  baseCapabilityId: z.string().min(1),
  baseSemver: z.string().min(1),
  variant: z.string().min(1),
  /** Keyed by the base artifact's own step id; each value is a complete Step, not a partial patch. */
  stepReplacements: z.record(z.string(), StepSchema),
});
export type TenantOverride = z.infer<typeof TenantOverrideSchema>;

export type ApplyOverrideResult = { ok: true; artifact: Artifact } | { ok: false; reason: string };

export function applyOverride(base: Artifact, override: TenantOverride): ApplyOverrideResult {
  if (base.capability.id !== override.baseCapabilityId || base.capability.semver !== override.baseSemver) {
    return { ok: false, reason: `override targets ${override.baseCapabilityId}@${override.baseSemver}, but the given base artifact is ${base.capability.id}@${base.capability.semver}` };
  }

  const baseIds = new Set(base.steps.map((s) => s.id));
  for (const id of Object.keys(override.stepReplacements)) {
    if (!baseIds.has(id)) return { ok: false, reason: `override references step id "${id}", which does not exist in the base artifact -- refusing rather than silently ignoring it` };
  }

  const steps = base.steps.map((s) => override.stepReplacements[s.id] ?? s);
  const artifact: Artifact = { ...base, surface: { ...base.surface, variant: override.variant }, steps };

  const validated = validateArtifact(artifact);
  if (!validated.ok) return { ok: false, reason: `overridden artifact failed validation: ${validated.reason}` };
  return { ok: true, artifact: validated.artifact };
}
