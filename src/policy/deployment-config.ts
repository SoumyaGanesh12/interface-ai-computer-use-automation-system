/**
 * The deployment's own ceiling on what any capability may touch, loaded from a plain
 * JSON file an operator edits directly -- no code change required to narrow or widen it.
 * No artifact, however it declares its own policy, can act outside this (see
 * intersectAllowlist in ./allowlist). A missing or malformed file is a hard error, not a
 * silent fallback to "everything allowed": a deployment that hasn't configured this yet
 * should refuse to run capabilities, not run them as though it had no ceiling at all.
 */
import { readFileSync } from 'node:fs';
import * as z from 'zod';
import type { Allowlist } from './allowlist';

const DeploymentAllowlistSchema = z.object({
  allowedOrigins: z.array(z.string().min(1)),
  allowedActions: z.array(z.string().min(1)),
});

export function loadDeploymentAllowlist(path = 'config/allowlist.json'): Allowlist {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return DeploymentAllowlistSchema.parse(raw);
}
