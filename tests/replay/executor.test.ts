/**
 * The milestone test: the actual committed artifact, replayed against a real browser
 * driving the real fixture, with no model anywhere in the loop.
 *
 * The artifact hardcodes the real fixture port (4400) for the CLI demo path -- that's
 * intentional, artifacts are exactly where an app-specific URL belongs. This test
 * retargets a clone to its own ephemeral port instead, so it never depends on 4400
 * being free (a manually-running `npm run fixture` shouldn't break CI).
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
import type { Surface } from '../../src/surface/surface';

const ARTIFACT_PATH = 'artifacts/member-savings-balance@1.0.0.json';

function loadRaw(): unknown {
  return JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8'));
}

function retarget(artifact: Artifact, baseUrl: string): Artifact {
  const clone = structuredClone(artifact);
  const openLogin = clone.steps.find((s) => s.id === 'open-login');
  if (!openLogin || openLogin.action?.kind !== 'navigate') {
    throw new Error('expected an "open-login" step with a navigate action');
  }
  openLogin.action.url = `${baseUrl}/login`;
  clone.policy.allowedOrigins = [new URL(baseUrl).origin];
  return clone;
}

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'executor-test',
    headless: true,
    // Overridden by replay() via setPolicy() before any action dispatches, using
    // whichever artifact is actually running -- this is just a construction-time default.
    policy: { allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('replay: member-savings-balance', () => {
  it('the committed artifact is schema-valid as-is', () => {
    const result = validateArtifact(loadRaw());
    expect(result.ok).toBe(true);
  });

  it('succeeds for a real member and extracts the real balance', async () => {
    const validated = validateArtifact(loadRaw());
    if (!validated.ok) throw new Error(validated.reason);
    const artifact = retarget(validated.artifact, baseUrl);

    const result = await replay(artifact, { memberId: '41382' }, { surface, runId: generateRunId(artifact.capability.id) });

    expect(result.status).toBe('success');
    expect(result.outputs?.savingsBalance).toBe(1204.5);
    expect(result.locatorTiers.length).toBeGreaterThan(0);
    expect(result.drift).toEqual([]);
  }, 30000);

  it('reports a clean business outcome for an unknown member, not a crash', async () => {
    const validated = validateArtifact(loadRaw());
    if (!validated.ok) throw new Error(validated.reason);
    const artifact = retarget(validated.artifact, baseUrl);

    const result = await replay(artifact, { memberId: '00000' }, { surface, runId: generateRunId(artifact.capability.id) });

    expect(result.status).toBe('business_outcome');
    expect(result.outcome?.code).toBe('member_not_found');
  }, 30000);
});
