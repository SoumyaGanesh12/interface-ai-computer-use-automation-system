/**
 * Goal-driven observe -> decide -> act loop. Uses the same policy and escalation
 * machinery as replay: a click classified as a possibly irreversible action raises an
 * intervention and blocks on the lease -- the identical code path a stuck replay uses --
 * so discovery is safe by construction, not by a rule someone has to remember.
 * Default: irreversible actions are never dispatched automatically.
 *
 * Risk classification applies only to clicks (see classifyRisk): navigate/type/select/
 * read are treated as safe, matching the ordinary GET-is-safe assumption -- in this
 * system, only a click can trigger a state-changing form submission.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as z from 'zod';
import { AgentDecisionSchema, type AgentDecision } from './decision';
import { buildPrompt, type HistoryEntry } from './prompt';
import type { TraceFile, TraceStep } from './trace';
import { ModelQuotaExceededError, ModelRateLimitError, type ModelClient } from '../model/client';
import { generateDescriptor } from '../locator/generate';
import { classifyRisk, detectExistingOutcomeWarning } from '../policy/risk';
import { createEvidenceWriter } from '../evidence/writer';
import type { RunLease, InterventionRequest } from '../session/lease';
import type { OperatorChannel } from '../session/operator-channel';
import type { Surface } from '../surface/surface';
import type { Action } from '../surface/action';
import type { Allowlist } from '../policy/allowlist';

const DEFAULT_MAX_STEPS = 15;
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_NO_PROGRESS_LIMIT = 3;
/** Sized from measured gemini-3.6-flash usage (thinking tokens run ~345/step, invisible in prompt+completion); the spec's own draft of 60000 was tighter than real usage supports. */
const DEFAULT_MAX_TOKENS_PER_RUN = 80000;
const DEFAULT_ESCALATION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_JSON_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_CONSECUTIVE_ACTION_FAILURES = 3;
const MAX_ESCALATIONS_PER_RUN = 3;

export interface PreflightStep {
  intent: string;
  action: Action;
}

export interface DiscoverOptions {
  goal: string;
  target: string;
  runId: string;
  modelId: string;
  surface: Surface;
  model: ModelClient;
  policy: Allowlist;
  lease: RunLease;
  operatorChannel: OperatorChannel;
  preflight?: PreflightStep[];
  allowIrreversible?: boolean;
  maxSteps?: number;
  wallClockTimeoutMs?: number;
  noProgressLimit?: number;
  maxTokensPerRun?: number;
  escalationTimeoutMs?: number;
  tracesDir?: string;
  /** Called right after each step is recorded, so a caller (a CLI, a UI) can show live progress instead of silence until the run finishes. */
  onStep?: (step: TraceStep) => void;
}

export type DiscoveryStatus =
  | 'done'
  | 'stuck'
  | 'max_steps'
  | 'timeout'
  | 'no_progress'
  | 'too_many_failures'
  | 'budget_exceeded'
  | 'quota_exceeded'
  | 'model_error'
  | 'escalation_timeout'
  | 'escalation_limit';

export interface DiscoveryResult {
  status: DiscoveryStatus;
  runId: string;
  goal: string;
  target: string;
  outputs?: Record<string, string>;
  reason?: string;
  totalTokens: number;
  tracePath: string;
}

function actionSummary(action: Action): string {
  switch (action.kind) {
    case 'navigate':
      return `navigate to ${action.url}`;
    case 'click':
      return 'click';
    case 'type':
      return `type "${action.text}"`;
    case 'typeCredential':
      return `type credential (${action.credentialRef})`;
    case 'select':
      return `select "${action.option}"`;
    case 'read':
      return `read ${action.source}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function discover(opts: DiscoverOptions): Promise<DiscoveryResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const tracesDir = opts.tracesDir ?? 'traces';
  mkdirSync(tracesDir, { recursive: true });
  const tracePath = path.join(tracesDir, `${opts.runId}.json`);

  const writer = createEvidenceWriter(opts.runId);
  writer.write({ kind: 'run_started', detail: `discover: ${opts.goal}` });

  opts.surface.setPolicy(opts.policy);
  opts.surface.setRunId(opts.runId);

  const steps: TraceStep[] = [];
  function pushStep(step: TraceStep): void {
    steps.push(step);
    opts.onStep?.(step);
  }
  const history: HistoryEntry[] = [];
  let stepIndex = 0;
  let totalTokens = 0;
  let escalationCount = 0;
  let consecutiveFailures = 0;
  let consecutiveSameHash = 0;
  let lastHash: string | undefined;

  function finish(status: DiscoveryStatus, extra: { outputs?: Record<string, string>; reason?: string } = {}): DiscoveryResult {
    const trace: TraceFile = {
      runId: opts.runId,
      goal: opts.goal,
      target: opts.target,
      model: opts.modelId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status,
      outputs: extra.outputs,
      reason: extra.reason,
      totalTokens,
      steps,
    };
    writeFileSync(tracePath, JSON.stringify(trace, null, 2), 'utf-8');
    writer.write({ kind: 'run_finished', detail: status, result: { status, ...extra, totalTokens } });
    return { status, runId: opts.runId, goal: opts.goal, target: opts.target, totalTokens, tracePath, ...extra };
  }

  // --- preflight: fixed setup actions the model never sees, e.g. logging in ----------
  for (const p of opts.preflight ?? []) {
    const observation = await opts.surface.observe();
    const result = await opts.surface.act(p.action);
    pushStep({
      stepIndex: stepIndex++,
      source: 'preflight',
      rationale: '(preflight)',
      intent: p.intent,
      action: p.action,
      observationHash: observation.hash,
      result: result.ok ? 'ok' : 'failed',
      detail: result.ok ? undefined : `${result.reason}: ${result.detail}`,
      resolvedTier: result.ok ? result.resolvedTier : undefined,
    });
    if (!result.ok) {
      return finish('model_error', { reason: `preflight step "${p.intent}" failed: ${result.reason} -- ${result.detail}` });
    }
  }

  const maxModelSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  // --- main loop ----------------------------------------------------------------------
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (stepIndex - (opts.preflight?.length ?? 0) >= maxModelSteps) return finish('max_steps');
    if (Date.now() - started > (opts.wallClockTimeoutMs ?? DEFAULT_WALL_CLOCK_TIMEOUT_MS)) return finish('timeout');
    if (totalTokens >= (opts.maxTokensPerRun ?? DEFAULT_MAX_TOKENS_PER_RUN)) return finish('budget_exceeded');
    if (consecutiveFailures >= MAX_CONSECUTIVE_ACTION_FAILURES) {
      return finish('too_many_failures', { reason: `${consecutiveFailures} consecutive action failures` });
    }

    const observation = await opts.surface.observe();
    if (observation.hash === lastHash) {
      consecutiveSameHash++;
      if (consecutiveSameHash >= (opts.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT)) return finish('no_progress');
    } else {
      consecutiveSameHash = 0;
      lastHash = observation.hash;
    }

    const prompt = buildPrompt(opts.goal, history, observation);
    let decision: AgentDecision | undefined;
    let lastError = '';

    for (let attempt = 0; attempt <= MAX_JSON_RETRIES && !decision; attempt++) {
      const attemptPrompt = attempt === 0 ? prompt : `${prompt}\n\nYour previous response was invalid: ${lastError}\nReturn ONLY the corrected JSON object.`;

      let responseText: string;
      let responseTokens: number;
      let rateLimitRetries = 0;
      for (;;) {
        try {
          const response = await opts.model.complete(attemptPrompt);
          responseText = response.text;
          responseTokens = response.usage.totalTokens;
          break;
        } catch (err) {
          if (err instanceof ModelQuotaExceededError) return finish('quota_exceeded', { reason: err.message });
          if (err instanceof ModelRateLimitError && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            await delay(2 ** rateLimitRetries * 1000);
            rateLimitRetries++;
            continue;
          }
          return finish('model_error', { reason: (err as Error).message });
        }
      }
      totalTokens += responseTokens;

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(responseText);
      } catch {
        lastError = 'response was not valid JSON';
        continue;
      }
      const parsed = AgentDecisionSchema.safeParse(parsedJson);
      if (!parsed.success) {
        lastError = z.prettifyError(parsed.error);
        continue;
      }
      decision = parsed.data;
    }

    if (!decision) {
      return finish('model_error', { reason: `model did not return a valid decision after ${MAX_JSON_RETRIES + 1} attempts: ${lastError}` });
    }

    if (decision.decision.kind === 'stuck') {
      pushStep({ stepIndex: stepIndex++, source: 'model', rationale: decision.rationale, intent: decision.intent, observationHash: observation.hash, result: 'failed', detail: decision.decision.reason });
      return finish('stuck', { reason: decision.decision.reason });
    }

    if (decision.decision.kind === 'done') {
      pushStep({ stepIndex: stepIndex++, source: 'model', rationale: decision.rationale, intent: decision.intent, observationHash: observation.hash, result: 'ok', detail: 'goal reported complete' });
      return finish('done', { outputs: decision.decision.outputs });
    }

    // decision.decision.kind === 'act'
    const act = decision.decision.action;
    let action: Action | undefined;

    if (act.actionKind === 'navigate') {
      action = { kind: 'navigate', url: act.url };
    } else {
      const node = observation.nodes.find((n) => n.nodeId === act.targetNodeId);
      const target = node ? generateDescriptor(node, observation) : undefined;
      if (!node) {
        history.push({ intent: decision.intent, actionSummary: `${act.actionKind} on node ${act.targetNodeId}`, result: 'failed', detail: 'target node not found in current observation' });
      } else if (!target) {
        history.push({ intent: decision.intent, actionSummary: `${act.actionKind} on node ${act.targetNodeId}`, result: 'failed', detail: 'could not build a reliable locator for this node' });
      } else if (act.actionKind === 'click') {
        action = { kind: 'click', target };
      } else if (act.actionKind === 'type') {
        action = { kind: 'type', target, text: act.text };
      } else if (act.actionKind === 'select') {
        action = { kind: 'select', target, option: act.option };
      } else {
        action = { kind: 'read', target, source: act.source };
      }
    }

    if (!action) {
      pushStep({ stepIndex: stepIndex++, source: 'model', rationale: decision.rationale, intent: decision.intent, observationHash: observation.hash, result: 'failed', detail: history.at(-1)?.detail });
      consecutiveFailures++;
      continue;
    }

    if (classifyRisk(action) === 'irreversible' && !opts.allowIrreversible) {
      if (escalationCount >= MAX_ESCALATIONS_PER_RUN) {
        pushStep({
          stepIndex: stepIndex++,
          source: 'model',
          rationale: decision.rationale,
          intent: decision.intent,
          action,
          observationHash: observation.hash,
          result: 'failed',
          detail: `at most ${MAX_ESCALATIONS_PER_RUN} escalations per run`,
        });
        return finish('escalation_limit', { reason: `at most ${MAX_ESCALATIONS_PER_RUN} escalations per run` });
      }
      escalationCount++;

      // The model's own rationale sometimes already names a reason this action might be
      // a duplicate (see classifyRisk's neighboring detectExistingOutcomeWarning for a
      // check that doesn't depend on the model volunteering it); both are folded into
      // what the human actually sees, not left sitting only in the trace file.
      const existingOutcomeWarning = detectExistingOutcomeWarning(observation);
      const reasonParts = [
        `classified as a possibly irreversible action: ${actionSummary(action)}`,
        `model's stated rationale: "${decision.rationale}"`,
      ];
      if (existingOutcomeWarning) reasonParts.push(`WARNING -- the current page already shows: "${existingOutcomeWarning}"`);

      const request: InterventionRequest = {
        runId: opts.runId,
        capability: opts.goal,
        stepId: `step-${stepIndex}`,
        intent: decision.intent,
        reason: reasonParts.join('\n  '),
        raisedAt: new Date().toISOString(),
      };
      writer.write({ kind: 'escalation_raised', detail: request.reason });
      await opts.surface.beginHumanActionRecording().catch(() => {});
      await opts.operatorChannel.notify(request);
      const outcome = await opts.lease.requestHandoff(request, opts.escalationTimeoutMs ?? DEFAULT_ESCALATION_TIMEOUT_MS);
      await opts.surface.endHumanActionRecording().catch(() => []);
      writer.write({ kind: 'escalation_resolved', detail: outcome });

      if (outcome === 'timeout') {
        pushStep({
          stepIndex: stepIndex++,
          source: 'model',
          rationale: decision.rationale,
          intent: decision.intent,
          action,
          observationHash: observation.hash,
          result: 'failed',
          detail: 'escalated, but no response before the escalation window elapsed',
        });
        return finish('escalation_timeout', { reason: 'no response before the escalation window elapsed' });
      }

      opts.lease.confirmResumed();
      pushStep({
        stepIndex: stepIndex++,
        source: 'model',
        rationale: decision.rationale,
        intent: decision.intent,
        action,
        observationHash: observation.hash,
        result: 'ok',
        detail: 'performed by a human after escalation, not dispatched automatically',
      });
      history.push({ intent: decision.intent, actionSummary: `${actionSummary(action)} (escalated to a human)`, result: 'ok' });
      consecutiveFailures = 0;
      continue;
    }

    const actResult = await opts.surface.act(action);
    pushStep({
      stepIndex: stepIndex++,
      source: 'model',
      rationale: decision.rationale,
      intent: decision.intent,
      action,
      observationHash: observation.hash,
      result: actResult.ok ? 'ok' : 'failed',
      detail: actResult.ok ? undefined : `${actResult.reason}: ${actResult.detail}`,
      resolvedTier: actResult.ok ? actResult.resolvedTier : undefined,
      readValue: actResult.ok ? actResult.value : undefined,
    });

    if (!actResult.ok) {
      history.push({ intent: decision.intent, actionSummary: actionSummary(action), result: 'failed', detail: `${actResult.reason}: ${actResult.detail}` });
      consecutiveFailures++;
      continue;
    }

    consecutiveFailures = 0;
    history.push({ intent: decision.intent, actionSummary: actionSummary(action), result: 'ok', readValue: actResult.value });
  }
}
