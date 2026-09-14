/**
 * Proves a fresh replay() call never reports an outcome based on whatever a *previous*
 * run left on the page. A Surface can legitimately be reused across runs in sequence
 * (see Surface.setRunId's own doc comment) -- found for real when a newly-added
 * "already_ordered" outcome on order-replacement-card started firing for a wholly
 * unrelated run in the same test file, because the browser was still showing a *prior*
 * run's leftover page at the moment the new run's very first observation was taken,
 * before it had dispatched even its own first navigate.
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
import type { Surface } from '../../src/surface/surface';

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'stale-page-state-test',
    headless: true,
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'type', 'typeCredential', 'click'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

function baseArtifact(id: string, steps: Artifact['steps'], extra: Partial<Artifact> = {}): Artifact {
  return {
    artifactSchemaVersion: 1,
    capability: { id, name: id, semver: '1.0.0', description: 'stale-page-state test artifact' },
    surface: { kind: 'web', app: 'fixture', appVersion: '1.0.0', variant: 'base' },
    requires: { authenticated: false },
    approval: { state: 'approved', verifiedRuns: 0 },
    inputs: [],
    outputs: [],
    steps,
    outcomes: [],
    recovery: [],
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'type', 'typeCredential', 'click'] },
    provenance: { discoveredAt: new Date().toISOString(), model: 'hand-authored', runId: 'test', humanAssisted: true },
    ...extra,
  };
}

const USERNAME_TARGET = { recordedTier: 1 as const, candidates: [{ tier: 1 as const, confidence: 0.95, note: 'x', locator: { strategy: 'roleAndName' as const, role: 'textbox' as const, name: 'Username' } }] };
const PASSWORD_TARGET = { recordedTier: 2 as const, candidates: [{ tier: 2 as const, confidence: 0.8, note: 'x', locator: { strategy: 'labelProximity' as const, labelText: 'Password', direction: 'right' as const, role: 'textbox' as const } }] };
const LOGIN_BUTTON_TARGET = { recordedTier: 1 as const, candidates: [{ tier: 1 as const, confidence: 0.95, note: 'x', locator: { strategy: 'roleAndName' as const, role: 'button' as const, name: 'Log In' } }] };

function loginSteps(): Artifact['steps'] {
  return [
    { id: 'open-login', intent: 'open the login page', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/login` }, checkpoint: { kind: 'nodeExists', target: USERNAME_TARGET }, risk: 'safe' },
    { id: 'enter-username', intent: 'enter the operator username', kind: 'action', action: { kind: 'type', target: USERNAME_TARGET, text: 'svc.operator' }, checkpoint: { kind: 'nodeExists', target: PASSWORD_TARGET }, risk: 'safe' },
    { id: 'enter-password', intent: 'enter the operator password', kind: 'action', action: { kind: 'typeCredential', target: PASSWORD_TARGET, credentialRef: 'FIXTURE_OPERATOR_PASSWORD' }, checkpoint: { kind: 'nodeExists', target: LOGIN_BUTTON_TARGET }, risk: 'safe' },
    { id: 'submit-login', intent: 'submit the login form', kind: 'action', action: { kind: 'click', target: LOGIN_BUTTON_TARGET }, checkpoint: { kind: 'urlMatches', pattern: '/app$' }, risk: 'safe' },
  ];
}

describe('stale page state across reused-surface runs', () => {
  it("a fresh run does not report a business outcome from the previous run's leftover page", async () => {
    // Run A logs in, then leaves the browser on a page containing "STALE_MARKER_TEXT".
    const runA = baseArtifact('stale-run-a', [
      ...loginSteps(),
      {
        id: 'leave-marker-page',
        intent: 'Navigate to a page containing a marker string',
        kind: 'action',
        action: { kind: 'navigate', url: `${baseUrl}/search?error=STALE_MARKER_TEXT` },
        checkpoint: { kind: 'textPresent', scope: 'page', pattern: 'STALE_MARKER_TEXT' },
        risk: 'safe',
      },
    ]);
    const resultA = await replay(runA, {}, { surface, runId: generateRunId('stale-run-a'), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(resultA.status).toBe('success');

    // Run B, on the SAME surface (as if reused across sequential capability calls),
    // declares an outcome that would match run A's leftover page -- but its own first
    // step navigates to a real page with no such text. Its own first observation, before
    // that navigate happens, is still run A's leftover marker page.
    const runB = baseArtifact(
      'stale-run-b',
      [
        {
          id: 'open-login',
          intent: 'open the login page',
          kind: 'action',
          action: { kind: 'navigate', url: `${baseUrl}/login` },
          checkpoint: { kind: 'nodeExists', target: { recordedTier: 1, candidates: [{ tier: 1, confidence: 0.95, note: 'x', locator: { strategy: 'roleAndName', role: 'textbox', name: 'Username' } }] } },
          risk: 'safe',
        },
      ],
      { outcomes: [{ code: 'false_positive', detect: { kind: 'textPresent', scope: 'page', pattern: 'STALE_MARKER_TEXT' }, message: 'should never fire' }] },
    );
    const resultB = await replay(runB, {}, { surface, runId: generateRunId('stale-run-b'), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });

    expect(resultB.status).toBe('success');
  }, 30000);
});
