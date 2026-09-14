/**
 * Proves a declared-sensitive output (the real balance, per the committed artifact's own
 * `redact: true`) never reaches the durable evidence/audit log in the clear, while the
 * value returned to the caller from replay() itself is untouched. Both checked against
 * the actual files written to disk, not the writer's internal state.
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

function readEvents(evidencePath: string): Array<Record<string, unknown>> {
  return readFileSync(evidencePath, 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'output-redaction-test',
    headless: true,
    policy: { allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('output redaction', () => {
  it('masks a redact:true output in the persisted evidence and audit logs, but returns the real value to the caller', async () => {
    const validated = validateArtifact(loadRaw());
    if (!validated.ok) throw new Error(validated.reason);
    expect(validated.artifact.outputs.find((o) => o.name === 'savingsBalance')?.redact).toBe(true);
    const artifact = retarget(validated.artifact, baseUrl);
    const runId = generateRunId(artifact.capability.id);

    const result = await replay(artifact, { memberId: '41382' }, {
      surface,
      runId,
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    });

    expect(result.status).toBe('success');
    // The caller-facing result is never redacted -- an agent invoking this capability
    // still needs the real balance back.
    expect(result.outputs?.savingsBalance).toBe(1204.5);

    const evidenceEvents = readEvents(`evidence/${runId}/events.jsonl`);
    const evidenceFinished = evidenceEvents.find((e) => e.kind === 'run_finished') as { result: { outputs: Record<string, unknown> } };
    expect(evidenceFinished.result.outputs.savingsBalance).toBe('[redacted]');

    const auditEvents = readEvents('audit/events.jsonl');
    const auditFinished = auditEvents.filter((e) => e.runId === runId && e.kind === 'run_finished').pop() as { result: { outputs: Record<string, unknown> } };
    expect(auditFinished.result.outputs.savingsBalance).toBe('[redacted]');
  }, 30000);
});
