/**
 * Proves the executor actually pauses mid-run and actually resumes -- not just that the
 * lease state machine works in isolation (tests/session/lease.test.ts), but that a real
 * replay() call blocks on it, a "human" (this test, calling the same methods a real
 * operator would) can unblock it, and the run genuinely continues afterward.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { replay, type ReplayDeps } from '../../src/replay/executor';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease, type LeaseState } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { Artifact } from '../../src/catalog/artifact';
import type { Surface } from '../../src/surface/surface';

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
    runId: 'escalation-test',
    headless: true,
    policy: { allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate'] },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

/** A minimal synthetic artifact -- navigate, then one step a human must complete. `checkpointPattern` controls whether the human-step's own checkpoint can ever be satisfied. */
function makeArtifact(checkpointPattern: string): Artifact {
  return {
    artifactSchemaVersion: 1,
    capability: { id: 'escalation-test', name: 'Escalation Test', semver: '1.0.0', description: 'exercises the escalation mechanism' },
    surface: { kind: 'web', app: 'fixture', appVersion: '1.0.0', variant: 'base' },
    requires: { authenticated: false },
    approval: { state: 'approved', verifiedRuns: 0 },
    inputs: [],
    outputs: [],
    steps: [
      {
        id: 'go',
        intent: 'open the login page',
        kind: 'action',
        action: { kind: 'navigate', url: `${baseUrl}/login` },
        checkpoint: { kind: 'urlMatches', pattern: '/login$' },
        risk: 'safe',
      },
      {
        id: 'human-step',
        intent: 'a human confirms something manually',
        kind: 'escalate',
        escalateReason: 'needs a human to verify',
        checkpoint: { kind: 'urlMatches', pattern: checkpointPattern },
        risk: 'safe',
      },
    ],
    outcomes: [],
    recovery: [],
    policy: { allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate'] },
    provenance: { discoveredAt: new Date().toISOString(), model: 'hand-authored', runId: 'test', humanAssisted: true },
  };
}

describe('executor escalation', () => {
  it('pauses on an escalate step, resumes once a human releases control, and completes', async () => {
    const artifact = makeArtifact('/login$'); // resume-time checkpoint IS satisfiable
    const lease = new RunLease();
    const deps: ReplayDeps = { surface, runId: generateRunId(artifact.capability.id), lease, operatorChannel: new ConsoleOperatorChannel() };

    const promise = replay(artifact, {}, deps);

    await waitForLeaseState(lease, 'PAUSED_PENDING_HUMAN');
    const intervention = lease.getIntervention();
    expect(intervention?.stepId).toBe('human-step');
    // The operator gets a real screenshot of the state that triggered this, not just text.
    expect(intervention?.evidenceRef).toBeTruthy();
    expect(existsSync(intervention!.evidenceRef)).toBe(true);

    lease.takeControl();
    lease.releaseControl();

    const result = await promise;
    expect(result.status).toBe('success');
    expect(result.humanInterventions).toEqual([{ stepId: 'human-step', reason: 'needs a human to verify', durationMs: expect.any(Number) }]);
  }, 15000);

  it('times out when nobody responds within the configured window', async () => {
    const artifact = makeArtifact('/login$');
    const deps: ReplayDeps = {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      escalationTimeoutMs: 150,
    };

    const result = await replay(artifact, {}, deps);
    expect(result.status).toBe('failure');
    expect(result.failure?.kind).toBe('escalation_timeout');
  }, 15000);

  it('re-escalates when resume checkpoint still fails, and hits the per-run cap', async () => {
    // A pattern the URL can never match: every resume attempt fails verification.
    const artifact = makeArtifact('/this-can-never-match-xyz$');
    const lease = new RunLease();
    const deps: ReplayDeps = { surface, runId: generateRunId(artifact.capability.id), lease, operatorChannel: new ConsoleOperatorChannel() };

    const promise = replay(artifact, {}, deps);

    // A "human" who keeps saying "done" three times without actually fixing anything.
    for (let i = 0; i < 3; i++) {
      await waitForLeaseState(lease, 'PAUSED_PENDING_HUMAN');
      lease.takeControl();
      lease.releaseControl();
    }

    const result = await promise;
    expect(result.status).toBe('failure');
    expect(result.failure?.kind).toBe('escalation_limit');
    expect(result.humanInterventions.length).toBe(3);
  }, 15000);
});
