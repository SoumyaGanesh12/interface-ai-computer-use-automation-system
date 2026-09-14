/**
 * Proves cross-tenant reuse against the real fixture, both directions: the unmodified
 * base artifact genuinely fails against tenant b (its "Member ID" label doesn't exist
 * there -- proving the override is actually necessary, not cosmetic), and the same base
 * artifact with the committed override applied genuinely succeeds against tenant b,
 * extracting the same real balance the base artifact reads for tenant a.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { validateArtifact } from '../../src/catalog/validate';
import { applyOverride, TenantOverrideSchema } from '../../src/registry/override';
import { replay } from '../../src/replay/executor';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { Artifact } from '../../src/catalog/artifact';
import type { Surface } from '../../src/surface/surface';

const BASE_PATH = 'artifacts/member-savings-balance@1.0.0.json';
const OVERRIDE_PATH = 'artifacts/member-savings-balance@1.0.0+b.json';

function loadRetargetedBase(baseUrl: string): Artifact {
  const raw = readFileSync(BASE_PATH, 'utf-8').replaceAll('http://localhost:4400', baseUrl);
  const result = validateArtifact(JSON.parse(raw));
  if (!result.ok) throw new Error(result.reason);
  return result.artifact;
}

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'override-test',
    headless: true,
    policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
    credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

beforeEach(async () => {
  await surface.act({ kind: 'navigate', url: `${baseUrl}/_control/tenant/b` });
});

describe('applyOverride', () => {
  it('the committed override file is schema-valid and targets the committed base artifact', () => {
    const raw = JSON.parse(readFileSync(OVERRIDE_PATH, 'utf-8'));
    const parsed = TenantOverrideSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.baseCapabilityId).toBe('member-savings-balance');
    expect(parsed.data.variant).toBe('b');
  });

  it('refuses an override that references a step id the base artifact does not have', () => {
    const base = loadRetargetedBase(baseUrl);
    const result = applyOverride(base, { baseCapabilityId: base.capability.id, baseSemver: base.capability.semver, variant: 'b', stepReplacements: { 'no-such-step': base.steps[0]! } });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('no-such-step') });
  });

  it('refuses an override that escalates a safe step to irreversible -- not a privilege-escalation path around risk/approval gating', () => {
    const base = loadRetargetedBase(baseUrl);
    const safeStep = base.steps.find((s) => s.risk === 'safe');
    if (!safeStep) throw new Error('expected at least one safe step on the base artifact');
    const result = applyOverride(base, {
      baseCapabilityId: base.capability.id,
      baseSemver: base.capability.semver,
      variant: 'b',
      stepReplacements: { [safeStep.id]: { ...safeStep, risk: 'irreversible' } },
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('risk') });
  });

  it('the unmodified base artifact genuinely fails against tenant b -- proving the override is necessary', async () => {
    const base = loadRetargetedBase(baseUrl);
    const result = await replay(base, { memberId: '41382' }, { surface, runId: generateRunId(base.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(result.status).toBe('failure');
    // Specifically because "Member ID" doesn't exist on tenant b's page -- not some
    // unrelated failure that would happen to any artifact regardless of the override.
    expect(result.failure?.stepId).toBe('enter-member-id');
  }, 20000);

  it('the base artifact with the committed override applied genuinely succeeds against tenant b, reading the real balance', async () => {
    const base = loadRetargetedBase(baseUrl);
    const override = TenantOverrideSchema.parse(JSON.parse(readFileSync(OVERRIDE_PATH, 'utf-8')));
    const overridden = applyOverride(base, override);

    expect(overridden.ok).toBe(true);
    if (!overridden.ok) return;
    expect(overridden.artifact.surface.variant).toBe('b');

    const result = await replay(overridden.artifact, { memberId: '41382' }, { surface, runId: generateRunId(overridden.artifact.capability.id), lease: new RunLease(), operatorChannel: new ConsoleOperatorChannel() });
    expect(result.status).toBe('success');
    expect(result.outputs?.savingsBalance).toBe(1204.5);
  }, 20000);
});
