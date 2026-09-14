/**
 * Proves the fixture's genuine form-validation path (submitting the member search with no
 * ID -- a real redirect + inline error, not a fault injected via /_control/) is reported
 * as a clean business outcome, not a crash or a checkpoint_failed. Built from the real
 * committed member-savings-balance login + search steps, minus the type-member-id step,
 * so the search is genuinely submitted empty through the real UI.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { validateArtifact } from '../../src/catalog/validate';
import { replay } from '../../src/replay/executor';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { Artifact } from '../../src/catalog/artifact';
import type { Surface } from '../../src/surface/surface';

const ARTIFACT_PATH = 'artifacts/member-savings-balance@1.0.0.json';

function loadBase(): Artifact {
  const raw = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8'));
  const result = validateArtifact(raw);
  if (!result.ok) throw new Error(result.reason);
  return result.artifact;
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
    runId: 'validation-error-test',
    headless: true,
    policy: { allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('validation error', () => {
  it('reports a clean business outcome for a search submitted with no member id, not a crash', async () => {
    const base = retarget(loadBase(), baseUrl);
    const submitSearch = base.steps.find((s) => s.id === 'submit-search');
    if (!submitSearch) throw new Error('expected a submit-search step on the base artifact');
    // Every login step up to and including submit-login, then submit-search directly --
    // deliberately skipping enter-member-id, so the search is genuinely submitted empty.
    const steps = base.steps.filter((s) => s.id !== 'enter-member-id' && s.id !== 'submit-search').concat(submitSearch);

    const artifact: Artifact = {
      ...base,
      capability: { ...base.capability, id: 'validation-error-test' },
      inputs: [],
      steps,
      outcomes: [
        {
          code: 'missing_member_id',
          detect: { kind: 'textPresent', scope: 'page', pattern: 'Enter a member ID to search' },
          message: 'A member ID is required before searching.',
        },
      ],
    };
    const validated = validateArtifact(artifact);
    if (!validated.ok) throw new Error(validated.reason);

    const result = await replay(validated.artifact, {}, {
      surface,
      runId: generateRunId('validation-error-test'),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    });

    expect(result.status).toBe('business_outcome');
    expect(result.outcome?.code).toBe('missing_member_id');
  }, 20000);
});
