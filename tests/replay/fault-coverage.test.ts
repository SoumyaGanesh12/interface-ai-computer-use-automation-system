/**
 * Proves each of the fixture's six injectable faults is handled correctly by a real
 * replay() call, not just that the fixture can produce the page. Each fault is set via
 * a real navigate step to /_control/fault/:mode (the same test-harness route
 * src/replay -- and the discovery agent -- are never allowlisted to reach) so it fires
 * deterministically at a known point in a real run, rather than depending on timing.
 *
 * not_found and permission: a clean business outcome, not a crash -- proven against the
 * fault-injected page directly, not just an incidentally-similar "unknown ID" case.
 * slow and server_error: replay tolerates an added delay without a false timeout, and
 * reports a real failure (not an exception) on a real 500, respectively.
 * dialog and session_expired: a declared recovery genuinely retries and completes --
 * session_expired's recovery re-authenticates through the identical embedded login form
 * the fault page renders, then the interrupted step (a navigate, so it carries no lost
 * in-page state) is redispatched directly by URL and succeeds once the fault clears.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { replay } from '../../src/replay/executor';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { Artifact } from '../../src/catalog/artifact';
import type { Step } from '../../src/catalog/step';
import type { Surface } from '../../src/surface/surface';

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'fault-coverage-test',
    headless: true,
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

const USERNAME_TARGET = { recordedTier: 1 as const, candidates: [{ tier: 1 as const, confidence: 0.95, note: 'Real <label for> on this field.', locator: { strategy: 'roleAndName' as const, role: 'textbox' as const, name: 'Username' } }] };
const PASSWORD_TARGET = { recordedTier: 2 as const, candidates: [{ tier: 2 as const, confidence: 0.8, note: "No label -- only the adjacent 'Password' cell.", locator: { strategy: 'labelProximity' as const, labelText: 'Password', direction: 'right' as const, role: 'textbox' as const } }] };
const LOGIN_BUTTON_TARGET = { recordedTier: 1 as const, candidates: [{ tier: 1 as const, confidence: 0.95, note: 'A real <button>.', locator: { strategy: 'roleAndName' as const, role: 'button' as const, name: 'Log In' } }] };
const SAVINGS_TARGET = { recordedTier: 2 as const, candidates: [{ tier: 2 as const, confidence: 0.75, note: "The balance cell has no id or label of its own -- only its row's 'Savings' text.", locator: { strategy: 'labelProximity' as const, labelText: 'Savings', direction: 'right' as const, role: 'cell' as const } }] };
const CONFIRM_ORDER_TARGET = { recordedTier: 1 as const, candidates: [{ tier: 1 as const, confidence: 0.9, note: 'A real <button>.', locator: { strategy: 'roleAndName' as const, role: 'button' as const, name: 'Confirm Order' } }] };

function loginSteps(): Step[] {
  return [
    { id: 'open-login', intent: 'Open the login page', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/login` }, checkpoint: { kind: 'nodeExists', target: USERNAME_TARGET }, risk: 'safe' },
    { id: 'enter-username', intent: 'Enter the operator username', kind: 'action', action: { kind: 'type', target: USERNAME_TARGET, text: 'svc.operator' }, checkpoint: { kind: 'nodeExists', target: PASSWORD_TARGET }, risk: 'safe' },
    { id: 'enter-password', intent: 'Enter the operator password', kind: 'action', action: { kind: 'typeCredential', target: PASSWORD_TARGET, credentialRef: 'FIXTURE_OPERATOR_PASSWORD' }, checkpoint: { kind: 'nodeExists', target: LOGIN_BUTTON_TARGET }, risk: 'safe' },
    { id: 'submit-login', intent: 'Submit the login form', kind: 'action', action: { kind: 'click', target: LOGIN_BUTTON_TARGET }, checkpoint: { kind: 'urlMatches', pattern: '/app$' }, risk: 'safe' },
  ];
}

function setFaultStep(mode: string): Step {
  return {
    id: `set-fault-${mode}`,
    intent: `Set the ${mode} fault (test-only harness route, never reachable by a real capability)`,
    kind: 'action',
    action: { kind: 'navigate', url: `${baseUrl}/_control/fault/${mode}` },
    checkpoint: { kind: 'textPresent', scope: 'page', pattern: `fault set to ${mode}` },
    risk: 'safe',
  };
}

function baseArtifact(id: string, steps: Step[], extra: Partial<Artifact> = {}): Artifact {
  return {
    artifactSchemaVersion: 1,
    capability: { id, name: id, semver: '1.0.0', description: 'fault-coverage test artifact' },
    surface: { kind: 'web', app: 'fixture', appVersion: '1.0.0', variant: 'base' },
    requires: { authenticated: true },
    approval: { state: 'approved', verifiedRuns: 0 },
    inputs: [],
    outputs: [],
    steps,
    outcomes: [],
    recovery: [],
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    provenance: { discoveredAt: new Date().toISOString(), model: 'hand-authored', runId: 'fault-coverage-test', humanAssisted: true },
    ...extra,
  };
}

describe('fault coverage', () => {
  it('not_found: a clean business outcome for a real member, not a crash', async () => {
    const artifact = baseArtifact(
      'fault-not-found',
      [
        ...loginSteps(),
        setFaultStep('not_found'),
        { id: 'view-member', intent: 'View member 41382', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/member?id=41382` }, checkpoint: { kind: 'nodeExists', target: SAVINGS_TARGET }, risk: 'safe' },
      ],
      { outcomes: [{ code: 'member_not_found', detect: { kind: 'textPresent', scope: 'page', pattern: 'No member found' }, message: 'No member was found for the given ID.' }] },
    );
    const result = await replay(artifact, {}, { surface, runId: generateRunId(artifact.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(result.status).toBe('business_outcome');
    expect(result.outcome?.code).toBe('member_not_found');
  }, 20000);

  it('permission: a clean business outcome, not a crash', async () => {
    const artifact = baseArtifact(
      'fault-permission',
      [
        ...loginSteps(),
        setFaultStep('permission'),
        { id: 'open-card-order', intent: 'Open the card order screen for member 41382', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/card/order?id=41382` }, checkpoint: { kind: 'nodeExists', target: CONFIRM_ORDER_TARGET }, risk: 'safe' },
      ],
      { outcomes: [{ code: 'permission_denied', detect: { kind: 'textPresent', scope: 'page', pattern: 'do not have permission' }, message: 'The operator does not have permission for this action.' }] },
    );
    const result = await replay(artifact, {}, { surface, runId: generateRunId(artifact.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(result.status).toBe('business_outcome');
    expect(result.outcome?.code).toBe('permission_denied');
  }, 20000);

  it('slow: tolerates an added delay without a false timeout or failure', async () => {
    const artifact = baseArtifact('fault-slow', [
      ...loginSteps(),
      setFaultStep('slow'),
      { id: 'view-member', intent: 'View member 41382', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/member?id=41382` }, checkpoint: { kind: 'nodeExists', target: SAVINGS_TARGET }, risk: 'safe' },
    ]);
    const started = Date.now();
    const result = await replay(artifact, {}, { surface, runId: generateRunId(artifact.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(result.status).toBe('success');
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900); // the fixture's own slow-fault delay is 3000ms
  }, 20000);

  it('server_error: an unanticipated condition fails safely, with full diagnostic detail, via no special-casing', async () => {
    // This artifact declares no outcome and no recovery for server_error at all (or for
    // anything else) -- baseArtifact defaults to outcomes: [] and recovery: []. Nothing
    // in src/replay/executor.ts even mentions "server_error"; the only reason this comes
    // back as a clean, diagnosable failure rather than an exception or a false success is
    // the generic fallback every step goes through: no recovery matches, no outcome
    // matches, the checkpoint never passes, the attempt budget exhausts, and the single
    // shared failure() helper reports it. That's the actual claim under test -- not that
    // server_error specifically is handled, but that *nothing declared* still fails safely.
    const artifact = baseArtifact('fault-server-error', [
      ...loginSteps(),
      setFaultStep('server_error'),
      { id: 'view-member', intent: 'View member 41382', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/member?id=41382` }, checkpoint: { kind: 'nodeExists', target: SAVINGS_TARGET }, risk: 'safe' },
    ]);
    const result = await replay(artifact, {}, { surface, runId: generateRunId(artifact.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });

    expect(result.status).toBe('failure');
    expect(result.status).not.toBe('business_outcome');
    expect(result.status).not.toBe('success');
    expect(result.failure?.kind).toBe('checkpoint_failed');
    // Full diagnostic detail: which step, what it expected, what actually happened.
    expect(result.failure?.stepId).toBe('view-member');
    expect(result.failure?.intent).toBe('View member 41382');
    expect(result.failure?.expected).toMatch(/checkpoint/i);
    expect(result.failure?.observed).toMatch(/attempt budget/i);
    // A real screenshot, not a placeholder -- proves evidenceRef() actually captured something.
    expect(result.failure?.evidenceRef).toBeTruthy();
    expect(result.failure?.evidenceRef).toMatch(/\.png$/);
  }, 20000);

  it('dialog: a declared recovery dismisses the interstitial and the run completes', async () => {
    const artifact = baseArtifact(
      'fault-dialog',
      [
        ...loginSteps(),
        setFaultStep('dialog'),
        { id: 'view-member', intent: 'View member 41382', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/member?id=41382` }, checkpoint: { kind: 'nodeExists', target: SAVINGS_TARGET }, risk: 'safe' },
      ],
      {
        recovery: [
          {
            code: 'dismiss_dialog',
            detect: { kind: 'textPresent', scope: 'page', pattern: 'Scheduled maintenance' },
            strategy: {
              kind: 'runSteps',
              steps: [
                {
                  id: 'dismiss-dialog-click',
                  intent: 'Dismiss the system notice',
                  kind: 'action',
                  action: { kind: 'click', target: { recordedTier: 1, candidates: [{ tier: 1, confidence: 0.9, note: 'A real <button>.', locator: { strategy: 'roleAndName', role: 'button', name: 'OK' } }] } },
                  // The OK button is genuinely gone once dismissed (we land on a
                  // different page entirely) -- a real assertion, not a guess.
                  checkpoint: { kind: 'nodeAbsent', target: { recordedTier: 1, candidates: [{ tier: 1, confidence: 0.9, note: 'A real <button>.', locator: { strategy: 'roleAndName', role: 'button', name: 'OK' } }] } },
                  risk: 'safe',
                },
              ],
            },
            maxAttempts: 1,
          },
        ],
      },
    );
    const result = await replay(artifact, {}, { surface, runId: generateRunId(artifact.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(result.status).toBe('success');
    expect(result.recoveries).toEqual([{ code: 'dismiss_dialog', attempts: 1 }]);
  }, 20000);

  it('session_expired: a declared recovery re-authenticates and the interrupted step redispatches successfully', async () => {
    const artifact = baseArtifact(
      'fault-session-expired',
      [
        ...loginSteps(),
        setFaultStep('session_expired'),
        { id: 'view-member', intent: 'View member 41382', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/member?id=41382` }, checkpoint: { kind: 'nodeExists', target: SAVINGS_TARGET }, risk: 'safe' },
      ],
      {
        recovery: [
          {
            code: 'relogin',
            detect: { kind: 'textPresent', scope: 'page', pattern: 'session has expired' },
            strategy: { kind: 'runSteps', steps: loginSteps().slice(1) }, // already on the embedded login form; no navigate needed
            maxAttempts: 1,
          },
        ],
      },
    );
    const result = await replay(artifact, {}, { surface, runId: generateRunId(artifact.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(result.status).toBe('success');
    expect(result.recoveries).toEqual([{ code: 'relogin', attempts: 1 }]);
  }, 20000);
});
