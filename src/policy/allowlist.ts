/**
 * Enforced inside Surface.act -- the single choke point. Any caller that drives a
 * Surface (replay today, discovery later) automatically gets the same guardrail; safety
 * doesn't depend on every caller remembering to check it separately.
 *
 * Artifact-level only for now: does this action's kind appear in `allowedActions`, and
 * (for navigate) does the target origin appear in `allowedOrigins`. The fuller model --
 * the effective allowlist as the intersection of this and a global config, so an
 * artifact can narrow but never widen its permissions -- requires config-loading; this
 * is the artifact-only half of that check.
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
