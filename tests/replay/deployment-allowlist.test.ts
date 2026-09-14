/**
 * Proves the deployment allowlist is actually enforced at replay time, not just a pure
 * function in isolation: an artifact whose own policy declares an action as allowed is
 * still denied when the deployment config's ceiling doesn't include it. The artifact
 * narrows what it's willing to touch; it can never widen past what the deployment
 * permits, regardless of what it declares for itself.
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
    runId: 'deployment-allowlist-test',
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

function makeArtifact(): Artifact {
  return {
    artifactSchemaVersion: 1,
    capability: { id: 'deployment-allowlist-test', name: 'Deployment Allowlist Test', semver: '1.0.0', description: 'exercises deployment-level allowlist narrowing' },
    surface: { kind: 'web', app: 'fixture', appVersion: '1.0.0', variant: 'base' },
    requires: { authenticated: true },
    approval: { state: 'approved', verifiedRuns: 0 },
    inputs: [],
    outputs: [],
    steps: [
      { id: 'open-login', intent: 'open the login page', kind: 'action', action: { kind: 'navigate', url: `${baseUrl}/login` }, checkpoint: { kind: 'nodeExists', target: USERNAME_TARGET }, risk: 'safe' },
      { id: 'enter-username', intent: 'enter the operator username', kind: 'action', action: { kind: 'type', target: USERNAME_TARGET, text: 'svc.operator' }, checkpoint: { kind: 'nodeExists', target: PASSWORD_TARGET }, risk: 'safe' },
      { id: 'enter-password', intent: 'enter the operator password', kind: 'action', action: { kind: 'typeCredential', target: PASSWORD_TARGET, credentialRef: 'FIXTURE_OPERATOR_PASSWORD' }, checkpoint: { kind: 'nodeExists', target: LOGIN_BUTTON_TARGET }, risk: 'safe' },
      // The artifact's own policy allows "click" -- only the deployment ceiling excludes it in the first test below.
      { id: 'submit-login', intent: 'submit the login form', kind: 'action', action: { kind: 'click', target: LOGIN_BUTTON_TARGET }, checkpoint: { kind: 'urlMatches', pattern: '/app$' }, risk: 'safe' },
    ],
    outcomes: [],
    recovery: [],
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    provenance: { discoveredAt: new Date().toISOString(), model: 'hand-authored', runId: 'test', humanAssisted: true },
  };
}

describe('deployment allowlist', () => {
  it('denies an action the artifact declares as allowed, when the deployment config does not include it', async () => {
    const artifact = makeArtifact();
    const result = await replay(artifact, {}, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      // The deployment's own ceiling permits navigate/type/typeCredential, but not click --
      // narrower than what this artifact declares for itself.
      deploymentAllowlist: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'type', 'typeCredential'] },
    });

    expect(result.status).toBe('failure');
    expect(result.failure?.kind).toBe('policy_denied');
    expect(result.failure?.stepId).toBe('submit-login');
  }, 20000);

  it('allows the same run to complete when the deployment config does include the action', async () => {
    const artifact = makeArtifact();
    const result = await replay(artifact, {}, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      deploymentAllowlist: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    });

    expect(result.status).toBe('success');
  }, 20000);
});
