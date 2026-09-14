/**
 * Proves the output_extraction failure kind is actually reachable and correctly reported:
 * every step (including its checkpoint) succeeds, but a declared output's own extraction
 * target never resolves. This is exactly the runtime condition a recorder-produced output
 * whose extraction candidates are keyed to one recorded value (see my-balance-lookup) would
 * hit against a different input -- distinct from every other failure kind, since nothing
 * about the *steps* failed, only the *output*.
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
    runId: 'output-extraction-failure-test',
    headless: true,
    policy: { allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('output extraction failure', () => {
  it('reports output_extraction, not a crash or a checkpoint failure, when every step succeeds but the declared output cannot be read', async () => {
    const base = retarget(loadBase(), baseUrl);

    const artifact: Artifact = {
      ...base,
      capability: { ...base.capability, id: 'output-extraction-failure-test' },
      outputs: [
        {
          name: 'nonexistentField',
          type: 'string',
          nullable: false,
          afterStep: 'submit-search',
          extraction: {
            target: {
              recordedTier: 2,
              candidates: [
                {
                  tier: 2,
                  confidence: 0.5,
                  note: 'Deliberately unresolvable -- no such label exists on this page.',
                  locator: { strategy: 'labelProximity', labelText: 'Totally Not A Real Label', direction: 'right', role: 'textbox' },
                },
              ],
            },
            source: 'text',
            transform: 'trim',
          },
          description: 'A field that does not exist, to exercise output_extraction.',
          redact: false,
        },
      ],
    };
    const validated = validateArtifact(artifact);
    if (!validated.ok) throw new Error(validated.reason);

    const result = await replay(validated.artifact, { memberId: '41382' }, {
      surface,
      runId: generateRunId('output-extraction-failure-test'),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    });

    expect(result.status).toBe('failure');
    expect(result.failure?.kind).toBe('output_extraction');
    expect(result.failure?.stepId).toBe('submit-search');
  }, 20000);
});
