/**
 * Proves the recorder against the two real, committed discovery traces, not a synthetic
 * fixture of the format: compiling derives real checkpoints from a real second run of
 * the trace's actions, and the compiled artifact is then genuinely replayable -- not
 * just schema-valid. The irreversible-action trace additionally proves compiling never
 * re-dispatches the action itself (checked against the fixture's own order store, not
 * just the compile result), and that the resulting escalate step is still replayable
 * once a real human performs the action for real.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { findOrder } from '../../fixture/orders';
import { compileArtifact } from '../../src/recorder/compile';
import { validateArtifact } from '../../src/catalog/validate';
import { replay } from '../../src/replay/executor';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease, type LeaseState } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { TraceFile } from '../../src/agent/trace';
import type { Surface } from '../../src/surface/surface';

function loadRetargetedTrace(path: string, baseUrl: string): TraceFile {
  const raw = readFileSync(path, 'utf-8').replaceAll('http://localhost:4400', baseUrl);
  return JSON.parse(raw) as TraceFile;
}

async function waitForLeaseState(lease: RunLease, state: LeaseState, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (lease.state !== state) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for lease state "${state}"; currently "${lease.state}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'recorder-test',
    headless: true,
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential', 'select', 'read'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('compileArtifact: member-savings-balance trace (all safe steps)', () => {
  it('compiles, validates, and the result genuinely replays', async () => {
    const trace = loadRetargetedTrace('traces/discovery-1789247660348.json', baseUrl);
    const result = await compileArtifact(trace, {
      surface,
      capability: { id: 'compiled-balance-lookup', name: 'Compiled Balance Lookup', semver: '1.0.0', description: 'Recorder-compiled from a discovery trace.' },
      app: 'member-services-console',
      appVersion: '1.0.0',
      variant: 'base',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { artifact } = result;

    expect(artifact.approval.state).toBe('draft');
    // The discovered output value ("$1204.50") was found on the final page and turned
    // into a real, self-verifying extraction -- not left empty for a human to fill in.
    expect(artifact.outputs).toEqual([
      expect.objectContaining({ name: 'savingsBalance', type: 'currency', extraction: expect.objectContaining({ transform: 'currency' }) }),
    ]);
    expect(artifact.steps.every((s) => s.kind === 'action')).toBe(true);
    expect(artifact.steps.every((s) => s.risk === 'safe')).toBe(true);
    // The last step's checkpoint is derived from the trace's own declared output value.
    const last = artifact.steps.at(-1)!;
    expect(last.checkpoint).toMatchObject({ kind: 'textPresent', scope: 'page' });

    expect(validateArtifact(artifact).ok).toBe(true);

    const replayResult = await replay(artifact, { memberId: '41382' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      allowDraft: true,
    });
    expect(replayResult.status).toBe('success');
    expect(replayResult.outputs?.savingsBalance).toBe(1204.5);
  }, 30000);

  it('parameterizes the typed member id, and the compiled capability genuinely works for a different member', async () => {
    const trace = loadRetargetedTrace('traces/discovery-1789247660348.json', baseUrl);
    const result = await compileArtifact(trace, {
      surface,
      capability: { id: 'compiled-balance-lookup-parameterized', name: 'Compiled Balance Lookup', semver: '1.0.0', description: 'Recorder-compiled from a discovery trace.' },
      app: 'member-services-console',
      appVersion: '1.0.0',
      variant: 'base',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { artifact } = result;

    // The JSON itself proves parameterization happened, not just that replay succeeded.
    expect(artifact.inputs).toContainEqual(expect.objectContaining({ name: 'memberId', required: true }));
    const typeAction = artifact.steps.map((s) => s.action).find((a) => a?.kind === 'type' && a.text.includes('{{'));
    expect(typeAction).toMatchObject({ kind: 'type', text: '{{memberId}}' });

    // The real proof: replaying with a DIFFERENT member id than the one recorded (41382)
    // actually looks up that different member (77410, "Brian Kim") and reports THAT
    // member's real balance (58900), not the one it happened to see during discovery
    // (41382, "Alice Johnson", 1204.50). A hardcoded artifact would report "success"
    // regardless of what input was passed -- the extracted value itself is what proves
    // this genuinely looked up a different member, not just that nothing crashed. The
    // URL alone couldn't prove this either: the search result loads inside a real HTML
    // frame, so the top-level document's own URL never changes.
    const replayResult = await replay(artifact, { memberId: '77410' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      allowDraft: true,
    });
    expect(replayResult.status).toBe('success');
    expect(replayResult.outputs?.savingsBalance).toBe(58900);
    const finalObservation = await surface.observe();
    const pageText = finalObservation.nodes.map((n) => `${n.name} ${n.value ?? ''} ${n.textContext ?? ''}`).join(' ');
    expect(pageText).toContain('Brian Kim');
    expect(pageText).not.toContain('Alice Johnson');
  }, 30000);
});

describe('compileArtifact: a trace that wandered through intermediate pages before succeeding', () => {
  it('does not apply the final-outputs checkpoint to an intermediate step whose next step also lacks a target', async () => {
    // Reproduces a real discovery run where the model navigated through pages that
    // don't lead anywhere useful (e.g. a 404) before finding the real flow: two
    // consecutive navigate steps in the middle of the sequence, neither of which is the
    // true last step. Only the true last step should ever get the outputs-derived
    // checkpoint (a dollar amount); an intermediate navigate must get a checkpoint about
    // its own resulting page, or it can never actually pass on replay.
    const trace: TraceFile = {
      runId: 'synthetic-wandering-run',
      goal: 'Find member 41382 and report their savings balance.',
      target: baseUrl,
      model: 'test',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'done',
      outputs: { savingsBalance: '$1204.50' },
      totalTokens: 0,
      steps: [
        { stepIndex: 0, source: 'preflight', rationale: '', intent: 'open the login page', action: { kind: 'navigate', url: `${baseUrl}/login` }, observationHash: 'h', result: 'ok' },
        {
          stepIndex: 1,
          source: 'preflight',
          rationale: '',
          intent: 'enter the operator username',
          action: { kind: 'type', target: { recordedTier: 1, candidates: [{ tier: 1, confidence: 0.95, note: 'x', locator: { strategy: 'roleAndName', role: 'textbox', name: 'Username' } }] }, text: 'svc.operator' },
          observationHash: 'h',
          result: 'ok',
        },
        {
          stepIndex: 2,
          source: 'preflight',
          rationale: '',
          intent: 'enter the operator password',
          action: {
            kind: 'typeCredential',
            target: { recordedTier: 2, candidates: [{ tier: 2, confidence: 0.8, note: 'x', locator: { strategy: 'labelProximity', labelText: 'Password', direction: 'right', role: 'textbox' } }] },
            credentialRef: 'FIXTURE_OPERATOR_PASSWORD',
          },
          observationHash: 'h',
          result: 'ok',
        },
        {
          stepIndex: 3,
          source: 'preflight',
          rationale: '',
          intent: 'submit the login form',
          action: { kind: 'click', target: { recordedTier: 1, candidates: [{ tier: 1, confidence: 0.95, note: 'x', locator: { strategy: 'roleAndName', role: 'button', name: 'Log In' } }] } },
          observationHash: 'h',
          result: 'ok',
        },
        // The model wandering: two navigations in a row, neither the true last step.
        { stepIndex: 4, source: 'model', rationale: 'trying the nav page', intent: 'Navigate to the nav page', action: { kind: 'navigate', url: `${baseUrl}/nav` }, observationHash: 'h', result: 'ok' },
        { stepIndex: 5, source: 'model', rationale: 'trying the search page directly', intent: 'Navigate to the search page', action: { kind: 'navigate', url: `${baseUrl}/search` }, observationHash: 'h', result: 'ok' },
        {
          stepIndex: 6,
          source: 'model',
          rationale: 'type the member id',
          intent: 'Type member ID 41382 into the search box',
          action: {
            kind: 'type',
            target: { recordedTier: 2, candidates: [{ tier: 2, confidence: 0.7, note: 'x', locator: { strategy: 'labelProximity', labelText: 'Member ID', direction: 'right', role: 'textbox' } }] },
            text: '41382',
          },
          observationHash: 'h',
          result: 'ok',
        },
        {
          stepIndex: 7,
          source: 'model',
          rationale: 'submit the search',
          intent: 'Click Search',
          action: { kind: 'click', target: { recordedTier: 3, candidates: [{ tier: 3, confidence: 0.6, note: 'x', locator: { strategy: 'visibleText', text: 'Search' } }] } },
          observationHash: 'h',
          result: 'ok',
        },
        { stepIndex: 8, source: 'model', rationale: 'done', intent: 'report the balance', observationHash: 'h', result: 'ok', detail: 'goal reported complete' },
      ],
    };

    const result = await compileArtifact(trace, {
      surface,
      capability: { id: 'compiled-wandering-balance-lookup', name: 'Compiled Wandering Balance Lookup', semver: '1.0.0', description: 'Recorder-compiled from a synthetic trace.' },
      app: 'member-services-console',
      appVersion: '1.0.0',
      variant: 'base',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { artifact } = result;

    // "Navigate to the nav page"'s next step is itself another bare navigate (no
    // target), so it must fall back to a urlMatches checkpoint about its own resulting
    // page -- not the final dollar-amount checkpoint, which only ever holds once the
    // whole run has finished.
    const navToNav = artifact.steps.find((s) => s.intent === 'Navigate to the nav page')!;
    expect(navToNav.checkpoint).toMatchObject({ kind: 'urlMatches' });
    expect(navToNav.checkpoint).not.toMatchObject({ kind: 'textPresent' });

    // "Navigate to the search page"'s next step (typing the member id) does have a
    // target, so it correctly gets nodeExists -- same as the login step itself.
    const navToSearch = artifact.steps.find((s) => s.intent === 'Navigate to the search page')!;
    expect(navToSearch.checkpoint).toMatchObject({ kind: 'nodeExists' });

    // Only the true last step gets the outputs-derived checkpoint.
    const last = artifact.steps.at(-1)!;
    expect(last.checkpoint).toMatchObject({ kind: 'textPresent', scope: 'page', pattern: '\\$\\d+\\.\\d+' });

    expect(validateArtifact(artifact).ok).toBe(true);

    const replayResult = await replay(artifact, { memberId: '41382' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      allowDraft: true,
    });
    expect(replayResult.status).toBe('success');
  }, 30000);
});

describe('compileArtifact: order-replacement-card trace (contains an irreversible step)', () => {
  it('stops at the irreversible step as an escalate step, without ever re-dispatching it', async () => {
    const before = findOrder('41382');
    expect(before).toBeUndefined(); // this test's own fixture instance has no prior order for this member

    const trace = loadRetargetedTrace('traces/discovery-1789249743303.json', baseUrl);
    const result = await compileArtifact(trace, {
      surface,
      capability: { id: 'compiled-order-replacement-card', name: 'Compiled Order Replacement Card', semver: '1.0.0', description: 'Recorder-compiled from a discovery trace.' },
      app: 'member-services-console',
      appVersion: '1.0.0',
      variant: 'base',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { artifact } = result;

    const last = artifact.steps.at(-1)!;
    expect(last.kind).toBe('escalate');
    expect(last.risk).toBe('safe');
    expect(last.action).toMatchObject({ kind: 'click' });
    // Genericized, not the literal recorded reference -- a fresh run produces a different one.
    expect(last.checkpoint).toMatchObject({ kind: 'textPresent', scope: 'page', pattern: expect.stringContaining('\\d+') });
    expect(artifact.steps.slice(0, -1).every((s) => s.kind === 'action')).toBe(true);
    expect(artifact.provenance.humanAssisted).toBe(true);

    expect(validateArtifact(artifact).ok).toBe(true);

    // The real proof: compiling never placed a real order.
    expect(findOrder('41382')).toBeUndefined();
  }, 30000);

  it('the compiled escalate step is genuinely replayable once a human performs the action for real', async () => {
    const trace = loadRetargetedTrace('traces/discovery-1789249743303.json', baseUrl);
    const compiled = await compileArtifact(trace, {
      surface,
      capability: { id: 'compiled-order-replacement-card-2', name: 'Compiled Order Replacement Card', semver: '1.0.0', description: 'Recorder-compiled from a discovery trace.' },
      app: 'member-services-console',
      appVersion: '1.0.0',
      variant: 'base',
    });
    if (!compiled.ok) throw new Error(compiled.reason);
    const artifact = compiled.artifact;
    const escalateStep = artifact.steps.at(-1)!;
    if (escalateStep.kind !== 'escalate') throw new Error('expected the last step to be an escalate step');

    const lease = new RunLease();
    const runId = generateRunId(artifact.capability.id);
    const promise = replay(artifact, { memberId: '41382' }, { surface, runId, lease, operatorChannel: new ConsoleOperatorChannel(), allowDraft: true });

    await waitForLeaseState(lease, 'PAUSED_PENDING_HUMAN');
    // The "human" genuinely performs the real actions needed -- not a shortcut. The
    // escalate step's carried `action` is only the one decision that triggered
    // escalation ("click Order Replacement Card", which just opens the confirm page);
    // the original discovery session's human takeover went further and also clicked
    // Confirm Order before releasing control, which the trace has no separate record of
    // (see the doc comment on compileArtifact). The checkpoint, not the carried action,
    // is the real authority on what a human must accomplish here.
    const openConfirmPage = await surface.act(escalateStep.action!);
    expect(openConfirmPage.ok).toBe(true);
    const confirmOrder = await surface.act({
      kind: 'click',
      target: { recordedTier: 1, candidates: [{ tier: 1, confidence: 0.9, note: 'test: the real irreversible dispatch', locator: { strategy: 'roleAndName', role: 'button', name: 'Confirm Order' } }] },
    });
    expect(confirmOrder.ok).toBe(true);
    lease.takeControl();
    lease.releaseControl();

    const result = await promise;
    expect(result.status).toBe('success');
    expect(findOrder('41382')?.reference).toMatch(/^REF-\d+$/);
  }, 30000);
});
