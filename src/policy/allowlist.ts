/**
 * Enforced inside Surface.act -- the single choke point. Any caller that drives a
 * Surface (replay today, discovery later) automatically gets the same guardrail; safety
 * doesn't depend on every caller remembering to check it separately.
 *
 * Does this action's kind appear in `allowedActions`, and (for navigate) does the target
 * origin appear in `allowedOrigins`. Callers pass the *effective* allowlist -- see
 * intersectAllowlist below for how that's computed from a deployment config and an
 * artifact's own policy -- so this function itself never needs to know two allowlists
 * are involved.
 */
import type { Action } from '../surface/action';

export interface Allowlist {
  allowedOrigins: string[];
  allowedActions: string[];
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkPolicy(action: Action, policy: Allowlist): PolicyCheckResult {
  if (!policy.allowedActions.includes(action.kind)) {
    return { allowed: false, reason: `action kind "${action.kind}" is not in this artifact's allowed actions` };
  }
  if (action.kind === 'navigate') {
    let origin: string;
    try {
      origin = new URL(action.url).origin;
    } catch {
      return { allowed: false, reason: `cannot parse navigate URL "${action.url}"` };
    }
    if (!policy.allowedOrigins.includes(origin)) {
      return { allowed: false, reason: `origin "${origin}" is not in this artifact's allowed origins` };
    }
  }
  return { allowed: true };
}

/**
 * The effective allowlist for a run is the INTERSECTION of a deployment-level config and
 * the artifact's own declared policy: an artifact can narrow what it's willing to touch,
 * but can never widen its permissions beyond what the deployment permits regardless of
 * what the artifact itself declares. Order of the two arguments doesn't matter -- the
 * result is symmetric.
 */
export function intersectAllowlist(config: Allowlist, artifactPolicy: Allowlist): Allowlist {
  return {
    allowedOrigins: config.allowedOrigins.filter((o) => artifactPolicy.allowedOrigins.includes(o)),
    allowedActions: config.allowedActions.filter((a) => artifactPolicy.allowedActions.includes(a)),
  };
}
