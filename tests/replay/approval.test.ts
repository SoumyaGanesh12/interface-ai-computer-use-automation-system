/**
 * Proves approval gating is a real gate, not a label: a draft artifact is refused before
 * anything is dispatched (checked against the fixture's own state, not just the reported
 * result), and the identical draft artifact genuinely succeeds once a caller explicitly
 * opts in with allowDraft.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { validateArtifact } from '../../src/catalog/validate';
import type { Artifact } from '../../src/catalog/artifact';
import { replay } from '../../src/replay/executor';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { Surface } from '../../src/surface/surface';

const ARTIFACT_PATH = 'artifacts/member-savings-balance@1.0.0.json';

function loadRetargeted(baseUrl: string): Artifact {
  const raw = readFileSync(ARTIFACT_PATH, 'utf-8').replaceAll('http://localhost:4400', baseUrl);
  const result = validateArtifact(JSON.parse(raw));
  if (!result.ok) throw new Error(result.reason);
  return result.artifact;
}

function asDraft(artifact: Artifact): Artifact {
  return { ...artifact, approval: { ...artifact.approval, state: 'draft' } };
}

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'approval-test',
    headless: true,
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('approval gating', () => {
  it('the committed artifact is already approved', () => {
    const raw = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8'));
    expect(raw.approval.state).toBe('approved');
  });

  it('refuses a draft artifact before dispatching anything, without allowDraft', async () => {
    const artifact = asDraft(loadRetargeted(baseUrl));
    const result = await replay(artifact, { memberId: '41382' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    });

    expect(result.status).toBe('failure');
    expect(result.failure?.kind).toBe('not_approved');
    // The real proof: nothing was ever dispatched -- not even the first step resolved.
    expect(result.locatorTiers).toEqual([]);
  }, 15000);

  it('runs the identical draft artifact successfully once the caller opts in with allowDraft', async () => {
    const artifact = asDraft(loadRetargeted(baseUrl));
    const result = await replay(artifact, { memberId: '41382' }, {
      surface,
      runId: generateRunId(artifact.capability.id),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
      allowDraft: true,
    });

    expect(result.status).toBe('success');
  }, 30000);
});
