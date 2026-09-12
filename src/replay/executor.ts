/**
 * Runs a capability with no model in the decision loop. Recovery is checked before
 * outcomes at every re-entry, and recovery exhaustion never falls through to an
 * outcome match -- a stuck session-expiry must not be misreported as a business result.
 *
 * Irreversible steps: at-most-once, not exactly-once. A per-step in-memory `dispatched`
 * flag (this run only) means a checkpoint failure after dispatch never redispatches; it
 * consults the step's idempotency probe instead (navigating to `idempotency.navigateTo`
 * first when declared, so the probe checks a known route rather than whatever page a
 * failed checkpoint happened to leave us on), and escalates the ambiguity rather than
 * guessing. An irreversible dispatch is journaled with `durable: true` (fsync before
 * this function returns), so dispatch state remains determinable from disk if the
 * process crashes between that write and the actual click. Restart-time recovery itself
 * (scanning the journal for a dispatched-without-confirmed record after a crash) is a
 * documented cut -- this makes the crash state knowable, not automatically resumable.
 *
 * A business outcome (e.g. "member not found") often only becomes visible after the
 * *last* step, with no following step to trigger the usual pre-step outcome check --
 * so outcomes are checked once more after the loop, before extraction, not just between
 * steps.
 *
 * Policy is enforced inside Surface.act itself (the single choke point), not here --
 * this only configures the surface with this artifact's allowlist before the first
 * action. Every run, regardless of how it ends, is written through one evidence sink,
 * via `finish()`: no exit path can skip being logged.
 */
import type { Artifact } from '../catalog/artifact';
import type { Step } from '../catalog/step';
import { interpolate, interpolateAction } from '../catalog/interpolate';
import { evaluate } from '../matcher/evaluate';
import type { Matcher } from '../matcher/types';
import { extract } from '../matcher/extraction';
import { createEvidenceWriter } from '../evidence/writer';
import type { RunLease, InterventionRequest } from '../session/lease';
import type { OperatorChannel } from '../session/operator-channel';
import type { Surface } from '../surface/surface';
import type { Observation } from '../surface/observation';
import type { Tier } from '../locator/descriptor';
import type { ReplayResult } from './result';

const ATTEMPT_BUDGET = 3;
const MAX_ESCALATIONS_PER_RUN = 3;
const DEFAULT_ESCALATION_TIMEOUT_MS = 15 * 60 * 1000;

export interface ReplayDeps {
  surface: Surface;
  runId: string;
  lease: RunLease;
  operatorChannel: OperatorChannel;
  /** Default 15 minutes. A batch capability and a live call want different answers here. */
  escalationTimeoutMs?: number;
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
  const writer = createEvidenceWriter(deps.runId);
  const dispatched = new Set<string>();
  const recoveryAttempts = new Map<string, number>();
  const locatorTiers: ReplayResult['locatorTiers'] = [];
  const recoveries: ReplayResult['recoveries'] = [];
  const drift: ReplayResult['drift'] = [];
  const humanInterventions: ReplayResult['humanInterventions'] = [];
  let escalationCount = 0;

  writer.write({ kind: 'run_started', detail: artifact.capability.id, inputs, inputDeclarations: artifact.inputs });

  deps.surface.setPolicy(artifact.policy);
  deps.surface.setRunId(deps.runId);

  function base() {
    return {
      capability: artifact.capability.id,
      version: artifact.capability.semver,
      runId: deps.runId,
      durationMs: Date.now() - started,
      locatorTiers,
      recoveries,
      drift,
      humanInterventions,
    };
  }

  /** The one exit point. Every return in this function goes through here, so a run can never finish unlogged. */
  function finish(result: ReplayResult): ReplayResult {
    writer.write({ kind: 'run_finished', detail: result.status, result });
    return result;
  }

  async function evidenceRef(): Promise<string> {
    try {
      return (await deps.surface.capture()).screenshotPath;
    } catch {
      return '';
    }
  }

  async function failure(
    kind: NonNullable<ReplayResult['failure']>['kind'],
    stepId: string,
    intent: string,
    expected: string,
    observed: string,
  ): Promise<ReplayResult> {
    writer.write({ kind: 'step_failed', stepId, detail: `${kind}: ${observed}` });
    return finish({ status: 'failure', ...base(), failure: { kind, stepId, intent, expected, observed, evidenceRef: await evidenceRef() } });
  }

  /**
   * Raises an intervention and blocks on the lease. `verify`, when given, is re-checked
   * against a fresh observation once a human signals resume -- never assume they left the
   * session where expected; a still-failing verify re-escalates rather than proceeding.
   * Without `verify` (the recovery_exhausted case), the human is unblocking a
   * precondition, not completing the step itself, so the caller re-runs the ordinary
   * step loop from the top instead.
   */
  async function escalate(step: Step, reason: string, verify?: Matcher): Promise<ReplayResult | 'resumed'> {
    if (escalationCount >= MAX_ESCALATIONS_PER_RUN) {
      return failure('escalation_limit', step.id, step.intent, `at most ${MAX_ESCALATIONS_PER_RUN} escalations per run`, `escalation requested a ${escalationCount + 1}th time: ${reason}`);
    }
    escalationCount++;

    const request: InterventionRequest = {
      runId: deps.runId,
      capability: artifact.capability.id,
      stepId: step.id,
      intent: step.intent,
      reason,
      raisedAt: new Date().toISOString(),
    };
    const raisedAt = Date.now();
    writer.write({ kind: 'escalation_raised', stepId: step.id, detail: reason });
    await deps.surface.beginHumanActionRecording().catch(() => {});
    await deps.operatorChannel.notify(request);

    const outcome = await deps.lease.requestHandoff(request, deps.escalationTimeoutMs ?? DEFAULT_ESCALATION_TIMEOUT_MS);
    const humanActions = await deps.surface.endHumanActionRecording().catch(() => []);
    const durationMs = Date.now() - raisedAt;
    humanInterventions.push({ stepId: step.id, reason, durationMs });
    writer.write({ kind: 'escalation_resolved', stepId: step.id, detail: `${outcome}, ${humanActions.length} human action(s) recorded` });

    if (outcome === 'timeout') {
      return failure('escalation_timeout', step.id, step.intent, 'a human to take over within the configured window', 'no response before the escalation window elapsed');
    }

    if (!verify) {
      deps.lease.confirmResumed();
      return 'resumed';
    }
    const observation = await deps.surface.observe();
    const check = evaluate(verify, observation);
    deps.lease.confirmResumed();
    if (!check.satisfied) {
      return escalate(step, `resumed, but the expected condition still doesn't hold: ${check.evidence}`, verify);
    }
    return 'resumed';
  }

  for (const input of artifact.inputs) {
    if (input.required && !(input.name in inputs)) {
      return failure('hard', 'validate-inputs', 'validate inputs', `input "${input.name}" is provided`, 'missing');
    }
  }

  let lastObservation: Observation | undefined;

  for (const step of artifact.steps) {
    let attempts = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempts++;
      if (attempts > ATTEMPT_BUDGET) {
        return failure('checkpoint_failed', step.id, step.intent, 'checkpoint to pass', `attempt budget of ${ATTEMPT_BUDGET} exhausted`);
      }

      const observation = await deps.surface.observe();
      lastObservation = observation;

      // Recovery before outcomes, declaration order, at every re-entry.
      let retryFromTop = false;
      for (const r of artifact.recovery) {
        if (!evaluate(r.detect, observation).satisfied) continue;
        const used = recoveryAttempts.get(r.code) ?? 0;
        if (used >= r.maxAttempts) {
          // A human unblocking whatever recovery couldn't handle, not completing this
          // step itself -- no `verify`, so the outer loop re-runs the ordinary step
          // logic from the top on resume, rather than re-checking this step's own
          // checkpoint here.
          const outcome = await escalate(step, `recovery "${r.code}" exhausted after ${r.maxAttempts} attempt(s): detector still matches`);
          if (outcome !== 'resumed') return outcome;
          retryFromTop = true;
          break;
        }
        recoveryAttempts.set(r.code, used + 1);

        if (r.strategy.kind === 'preflight') {
          return failure('hard', step.id, step.intent, 'a configured preflight to run', 'preflight recovery requires app config that does not exist yet');
        }
        const outcome = await runRecoverySteps(r.strategy.steps, deps.surface);
        recoveries.push({ code: r.code, attempts: used + 1 });
        writer.write({ kind: 'recovery_attempted', stepId: step.id, detail: `${r.code}: ${outcome.ok ? 'succeeded' : outcome.detail}` });
        if (!outcome.ok) return failure('hard', step.id, step.intent, 'recovery sub-flow to succeed', outcome.detail);
        retryFromTop = true;
        break;
      }
      if (retryFromTop) continue; // re-observe and re-check from the top

      // Outcomes, declaration order.
      for (const o of artifact.outcomes) {
        if (evaluate(o.detect, observation).satisfied) {
          return finish({ status: 'business_outcome', ...base(), outcome: { code: o.code, message: o.message } });
        }
      }

      if (step.kind === 'escalate') {
        // A human-performed segment recorded during discovery: verify against this
        // step's own checkpoint on resume, since the whole point is confirming the
        // human actually completed it.
        const outcome = await escalate(step, step.escalateReason ?? 'escalate step', step.checkpoint);
        if (outcome !== 'resumed') return outcome;
        break; // the human completed this step; move to the next one.
      }
      const rawAction = step.action!;

      const interpolated = interpolateAction(rawAction, inputs);
      if (!interpolated.ok) {
        return failure('hard', step.id, step.intent, 'every {{template}} to resolve', `unresolved template "{{${interpolated.missing}}}"`);
      }

      // Irreversible + already dispatched this run: never redispatch. Consult idempotency instead.
      if (step.risk === 'irreversible' && dispatched.has(step.id)) {
        let probeObservation = observation;
        if (step.idempotency?.navigateTo) {
          const navTarget = interpolate(step.idempotency.navigateTo, inputs);
          if (!navTarget.ok) {
            return failure('hard', step.id, step.intent, 'every {{template}} to resolve', `unresolved template "{{${navTarget.missing}}}" in idempotency.navigateTo`);
          }
          const navResult = await deps.surface.act({ kind: 'navigate', url: navTarget.value });
          if (!navResult.ok) {
            return failure('idempotency_ambiguous', step.id, step.intent, 'to reach the idempotency probe route', `navigation to idempotency.navigateTo failed: ${navResult.detail}`);
          }
          probeObservation = await deps.surface.observe();
        }

        const probe = step.idempotency ? evaluate(step.idempotency.probe, probeObservation) : undefined;
        if (probe?.satisfied) {
          // Confirmed via the probe, not a direct checkpoint pass -- still a real
          // confirmation, so it's logged the same way a normal success would be.
          writer.journal({ stepId: step.id, status: 'confirmed' });
          writer.write({ kind: 'step_succeeded', stepId: step.id, detail: `confirmed via idempotency probe: ${probe.evidence}` });
          break;
        }

        // A human resolving this in 90 seconds is a correct outcome; a blind retry
        // that redispatches an irreversible action is not. Verify against this step's
        // own checkpoint on resume -- the human is confirming this step's own result.
        const detail = step.idempotency
          ? `idempotency probe did not confirm completion: ${probe!.evidence}`
          : 'already dispatched once this run; no idempotency probe declared';
        const outcome = await escalate(step, detail, step.checkpoint);
        if (outcome !== 'resumed') return outcome;
        writer.journal({ stepId: step.id, status: 'confirmed' });
        writer.write({ kind: 'step_succeeded', stepId: step.id, detail: 'confirmed via human escalation' });
        break; // the human confirmed this step's outcome; move to the next one.
      }

      if (step.risk === 'irreversible') dispatched.add(step.id);

      // fsync before dispatch, only for irreversible steps: if the process crashes
      // between this write and the actual dispatch (or between dispatch and reading
      // the checkpoint), dispatch state must remain determinable from disk, not memory.
      writer.journal({ stepId: step.id, status: 'dispatched' }, step.risk === 'irreversible');
      const actResult = await deps.surface.act(interpolated.action);
      if (!actResult.ok) {
        const kind = actResult.reason === 'ambiguous' ? 'locator_ambiguous' : actResult.reason === 'policy_denied' ? 'policy_denied' : 'locator_unresolved';
        return failure(kind, step.id, step.intent, 'action to dispatch cleanly', `${actResult.reason}: ${actResult.detail}`);
      }

      if (actResult.resolvedTier !== undefined && 'target' in rawAction) {
        const recordedTier: Tier = rawAction.target.recordedTier;
        locatorTiers.push({ stepId: step.id, recordedTier, resolvedTier: actResult.resolvedTier });
        if (actResult.resolvedTier > recordedTier) {
          drift.push({ stepId: step.id, recordedTier, resolvedTier: actResult.resolvedTier });
        }
      }

      if (step.wait) {
        const waitObservation = await deps.surface.observe();
        if (!evaluate(step.wait, waitObservation).satisfied) {
          return failure('checkpoint_failed', step.id, step.intent, 'wait condition to be satisfied', 'timed out waiting');
        }
      }

      const postObservation = await deps.surface.observe();
      lastObservation = postObservation;
      const checkpoint = evaluate(step.checkpoint, postObservation);
      if (!checkpoint.satisfied) continue; // retry: re-observe, re-check recovery/outcomes, possibly redispatch (safe) or hit the idempotency branch (irreversible)

      writer.journal({ stepId: step.id, status: 'confirmed' });
      writer.write({ kind: 'step_succeeded', stepId: step.id });
      break;
    }
  }

  // A business outcome that only becomes visible after the final step has no later
  // step to trigger the usual pre-step check -- so check once more here, before extraction.
  if (lastObservation) {
    for (const o of artifact.outcomes) {
      if (evaluate(o.detect, lastObservation).satisfied) {
        return finish({ status: 'business_outcome', ...base(), outcome: { code: o.code, message: o.message } });
      }
    }
  }

  const outputs: Record<string, unknown> = {};
  for (const output of artifact.outputs) {
    const observation = await deps.surface.observe();
    const result = extract(output.extraction, observation);
    if (!result.ok) {
      return failure('output_extraction', output.afterStep, `extract output "${output.name}"`, 'a value extractable per the declared transform', result.reason);
    }
    outputs[output.name] = result.value;
  }

  return finish({ status: 'success', ...base(), outputs });
}
