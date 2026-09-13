/**
 * The agent-facing surface over the artifact schema: what an agent deciding *which*
 * capability to call, and with what inputs, actually needs -- not the raw artifact.
 * A summary deliberately omits steps, locators, policy, and provenance: those are how
 * the capability works, not what an agent calling it needs to know. Invalid files on
 * disk are skipped with a reason, not a thrown exception -- one bad artifact must not
 * take the whole catalog down for every other capability.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateArtifact } from '../catalog/validate';
import { replay, type ReplayDeps } from '../replay/executor';
import type { Artifact } from '../catalog/artifact';
import type { ReplayResult } from '../replay/result';

export interface CapabilitySummary {
  id: string;
  name: string;
  semver: string;
  description: string;
  approvalState: 'draft' | 'approved';
  inputs: Array<{ name: string; type: string; required: boolean; description: string }>;
  outputs: Array<{ name: string; type: string; description: string }>;
}

function toSummary(artifact: Artifact): CapabilitySummary {
  return {
    id: artifact.capability.id,
    name: artifact.capability.name,
    semver: artifact.capability.semver,
    description: artifact.capability.description,
    approvalState: artifact.approval.state,
    inputs: artifact.inputs.map((i) => ({ name: i.name, type: i.type, required: i.required, description: i.description })),
    outputs: artifact.outputs.map((o) => ({ name: o.name, type: o.type, description: o.description })),
  };
}

/** Compares "1.2.3"-style semver strings; higher wins. Malformed segments sort as 0, never thrown. */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  return (b1! - a1!) || (b2! - a2!) || (b3! - a3!);
}

function loadArtifacts(dir: string): Artifact[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const artifacts: Artifact[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf-8'));
      const result = validateArtifact(raw);
      if (result.ok) artifacts.push(result.artifact);
    } catch {
      // an unreadable or malformed file is skipped, not a reason to fail the whole listing
    }
  }
  return artifacts;
}

/** Every valid capability found under `dir`, one entry per artifact file. Multiple versions of the same id all appear -- this lists what exists, findCapability decides which one to use. */
export function listCapabilities(dir = 'artifacts'): CapabilitySummary[] {
  return loadArtifacts(dir).map(toSummary);
}

/** The highest-semver artifact matching this id, or undefined if none exists. */
export function findCapability(id: string, dir = 'artifacts'): Artifact | undefined {
  const matches = loadArtifacts(dir).filter((a) => a.capability.id === id);
  matches.sort((a, b) => compareSemver(a.capability.semver, b.capability.semver));
  return matches[0];
}

export type InvokeResult = { ok: true; result: ReplayResult } | { ok: false; reason: string };

/**
 * Looks up a capability by id and replays it -- the one path an agent actually calls
 * through. Inherits every safety property replay() already has for free (approval
 * gating, policy enforcement, escalation): this is a thin lookup in front of it, not a
 * second implementation of any of that.
 */
export async function invokeCapability(id: string, inputs: Readonly<Record<string, string>>, deps: ReplayDeps, dir = 'artifacts'): Promise<InvokeResult> {
  const artifact = findCapability(id, dir);
  if (!artifact) return { ok: false, reason: `no capability found with id "${id}" under ${dir}` };
  return { ok: true, result: await replay(artifact, inputs, deps) };
}
