/**
 * Runs a capability with no model in the decision loop. Recovery is checked before
 * outcomes at every re-entry, and recovery exhaustion never falls through to an
 * outcome match -- a stuck session-expiry must not be misreported as a business result.
 *
 * Irreversible steps: at-most-once, not exactly-once. A per-step in-memory `dispatched`
 * flag (this run only -- the durable cross-process journal is a later concern) means a
 * checkpoint failure after dispatch never redispatches; it consults the step's
 * idempotency probe instead, and escalates the ambiguity rather than guessing.
 *
 * A business outcome (e.g. "member not found") often only becomes visible after the
 * *last* step, with no following step to trigger the usual pre-step outcome check --
 * so outcomes are checked once more after the loop, before extraction, not just between
 * steps.
 */
import type { Artifact } from '../catalog/artifact';
import type { Step } from '../catalog/step';
import { interpolateAction } from '../catalog/interpolate';
import { checkPolicy } from './policy';
import { evaluate } from '../matcher/evaluate';
import { extract } from '../matcher/extraction';
import type { Surface } from '../surface/surface';
import type { Observation } from '../surface/observation';
import type { Tier } from '../locator/descriptor';
import type { ReplayResult } from './result';

const ATTEMPT_BUDGET = 3;

export interface ReplayDeps {
  surface: Surface;
  runId: string;
}

/** Mutable, per-call state -- never module-level, so concurrent runs never share it. */
interface RunState {
  dispatched: Set<string>;
  recoveryAttempts: Map<string, number>;
  locatorTiers: ReplayResult['locatorTiers'];
  recoveries: ReplayResult['recoveries'];
  drift: ReplayResult['drift'];
}

async function evidenceRef(surface: Surface): Promise<string> {
  try {
    return (await surface.capture()).screenshotPath;
  } catch {
    return '';
  }
}

function base(artifact: Artifact, deps: ReplayDeps, started: number, state: RunState) {
  return {
    capability: artifact.capability.id,
    version: artifact.capability.semver,
    runId: deps.runId,
    durationMs: Date.now() - started,
    locatorTiers: state.locatorTiers,
    recoveries: state.recoveries,
    drift: state.drift,
    humanInterventions: [],
  };
}

async function failure(
  kind: NonNullable<ReplayResult['failure']>['kind'],
  stepId: string,
  intent: string,
  expected: string,
  observed: string,
  artifact: Artifact,
  deps: ReplayDeps,
  started: number,
  state: RunState,
): Promise<ReplayResult> {
  return {
    status: 'failure',
    ...base(artifact, deps, started, state),
    failure: { kind, stepId, intent, expected, observed, evidenceRef: await evidenceRef(deps.surface) },
  };
}

/** Every step in a recovery sub-flow is risk: 'safe' (schema-enforced), so this never touches the dispatched-flag branch. */
async function runRecoverySteps(steps: Step[], surface: Surface): Promise<{ ok: true } | { ok: false; detail: string }> {
  for (const step of steps) {
    if (step.kind !== 'action' || !step.action) return { ok: false, detail: `recovery step "${step.id}" is not a dispatchable action` };
    const result = await surface.act(step.action);
    if (!result.ok) return { ok: false, detail: `recovery step "${step.id}" failed: ${result.reason} -- ${result.detail}` };
    const observation = await surface.observe();
    const check = evaluate(step.checkpoint, observation);
    if (!check.satisfied) return { ok: false, detail: `recovery step "${step.id}" checkpoint failed: ${check.evidence}` };
  }
  return { ok: true };
}

export async function replay(artifact: Artifact, inputs: Readonly<Record<string, string>>, deps: ReplayDeps): Promise<ReplayResult> {
  const started = Date.now();
  const state: RunState = { dispatched: new Set(), recoveryAttempts: new Map(), locatorTiers: [], recoveries: [], drift: [] };

  for (const input of artifact.inputs) {
    if (input.required && !(input.name in inputs)) {
      return failure('hard', 'validate-inputs', 'validate inputs', `input "${input.name}" is provided`, 'missing', artifact, deps, started, state);
    }
  }

  let lastObservation: Observation | undefined;

  for (const step of artifact.steps) {
    let attempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempts++;
      if (attempts > ATTEMPT_BUDGET) {
        return failure('checkpoint_failed', step.id, step.intent, 'checkpoint to pass', `attempt budget of ${ATTEMPT_BUDGET} exhausted`, artifact, deps, started, state);
      }

      const observation = await deps.surface.observe();
      lastObservation = observation;

      // Recovery before outcomes, declaration order, at every re-entry.
      let recovered = false;
      for (const r of artifact.recovery) {
        if (!evaluate(r.detect, observation).satisfied) continue;
        const used = state.recoveryAttempts.get(r.code) ?? 0;
        if (used >= r.maxAttempts) {
          return failure('recovery_exhausted', step.id, step.intent, `recovery "${r.code}" within ${r.maxAttempts} attempt(s)`, 'detector still matches after exhausting attempts', artifact, deps, started, state);
        }
        state.recoveryAttempts.set(r.code, used + 1);

        if (r.strategy.kind === 'preflight') {
          return failure('hard', step.id, step.intent, 'a configured preflight to run', 'preflight recovery requires app config that does not exist yet', artifact, deps, started, state);
        }
        const outcome = await runRecoverySteps(r.strategy.steps, deps.surface);
        state.recoveries.push({ code: r.code, attempts: used + 1 });
        if (!outcome.ok) return failure('hard', step.id, step.intent, 'recovery sub-flow to succeed', outcome.detail, artifact, deps, started, state);
        recovered = true;
        break;
      }
      if (recovered) continue; // re-observe and re-check from the top

      // Outcomes, declaration order.
      for (const o of artifact.outcomes) {
        if (evaluate(o.detect, observation).satisfied) {
          return { status: 'business_outcome', ...base(artifact, deps, started, state), outcome: { code: o.code, message: o.message } };
        }
      }

      if (step.kind === 'escalate') {
        return failure('hard', step.id, step.intent, 'a human to perform this step', step.escalateReason ?? 'escalate step', artifact, deps, started, state);
      }
      const rawAction = step.action!;

      const interpolated = interpolateAction(rawAction, inputs);
      if (!interpolated.ok) {
        return failure('hard', step.id, step.intent, 'every {{template}} to resolve', `unresolved template "{{${interpolated.missing}}}"`, artifact, deps, started, state);
      }

      const policyResult = checkPolicy(interpolated.action, artifact.policy);
      if (!policyResult.allowed) {
        return failure('policy_denied', step.id, step.intent, 'action permitted by policy', policyResult.reason ?? 'denied', artifact, deps, started, state);
      }

      // Irreversible + already dispatched this run: never redispatch. Consult idempotency instead.
      if (step.risk === 'irreversible' && state.dispatched.has(step.id)) {
        if (!step.idempotency) {
          return failure('idempotency_ambiguous', step.id, step.intent, 'confirmation the action already completed', 'already dispatched once this run; no idempotency probe declared', artifact, deps, started, state);
        }
        const probe = evaluate(step.idempotency.probe, observation);
        if (!probe.satisfied) {
          return failure('idempotency_ambiguous', step.id, step.intent, 'idempotency probe to confirm completion', `probe did not confirm completion: ${probe.evidence}`, artifact, deps, started, state);
        }
        break; // probe confirms it already happened -- treat this step as satisfied, move on.
      }

      if (step.risk === 'irreversible') state.dispatched.add(step.id);

      const actResult = await deps.surface.act(interpolated.action);
      if (!actResult.ok) {
        const kind = actResult.reason === 'ambiguous' ? 'locator_ambiguous' : 'locator_unresolved';
        return failure(kind, step.id, step.intent, 'action to dispatch cleanly', `${actResult.reason}: ${actResult.detail}`, artifact, deps, started, state);
      }

      if (actResult.resolvedTier !== undefined && 'target' in rawAction) {
        const recordedTier: Tier = rawAction.target.recordedTier;
        state.locatorTiers.push({ stepId: step.id, recordedTier, resolvedTier: actResult.resolvedTier });
        if (actResult.resolvedTier > recordedTier) {
          state.drift.push({ stepId: step.id, recordedTier, resolvedTier: actResult.resolvedTier });
        }
      }

      if (step.wait) {
        const waitObservation = await deps.surface.observe();
        if (!evaluate(step.wait, waitObservation).satisfied) {
          return failure('checkpoint_failed', step.id, step.intent, 'wait condition to be satisfied', 'timed out waiting', artifact, deps, started, state);
        }
      }

      const postObservation = await deps.surface.observe();
      lastObservation = postObservation;
      const checkpoint = evaluate(step.checkpoint, postObservation);
      if (!checkpoint.satisfied) continue; // retry: re-observe, re-check recovery/outcomes, possibly redispatch (safe) or hit the idempotency branch (irreversible)

      break;
    }
  }

  // A business outcome that only becomes visible after the final step has no later
  // step to trigger the usual pre-step check -- so check once more here, before extraction.
  if (lastObservation) {
    for (const o of artifact.outcomes) {
      if (evaluate(o.detect, lastObservation).satisfied) {
        return { status: 'business_outcome', ...base(artifact, deps, started, state), outcome: { code: o.code, message: o.message } };
      }
    }
  }

  const outputs: Record<string, unknown> = {};
  for (const output of artifact.outputs) {
    const observation = await deps.surface.observe();
    const result = extract(output.extraction, observation);
    if (!result.ok) {
      return failure('output_extraction', output.afterStep, `extract output "${output.name}"`, 'a value extractable per the declared transform', result.reason, artifact, deps, started, state);
    }
    outputs[output.name] = result.value;
  }

  return { status: 'success', ...base(artifact, deps, started, state), outputs };
}
