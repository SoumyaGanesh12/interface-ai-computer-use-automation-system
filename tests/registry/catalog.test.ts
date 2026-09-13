/**
 * Proves the catalog against the real committed artifacts, not a synthetic fixture of
 * the format, and proves invokeCapability genuinely calls replay() end to end -- not
 * just that it returns something shaped like a result.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { listCapabilities, findCapability, invokeCapability } from '../../src/registry/catalog';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import { generateRunId } from '../../src/evidence/run-id';
import { RunLease } from '../../src/session/lease';
import { ConsoleOperatorChannel } from '../../src/session/operator-channel';
import type { Surface } from '../../src/surface/surface';

describe('listCapabilities / findCapability (real committed artifacts)', () => {
  it('lists both committed artifacts as approved, agent-facing summaries', () => {
    const summaries = listCapabilities('artifacts');
    const balance = summaries.find((s) => s.id === 'member-savings-balance');
    expect(balance).toMatchObject({ approvalState: 'approved', inputs: [{ name: 'memberId', required: true }] });
    expect(balance?.outputs[0]?.name).toBe('savingsBalance');
    // Deliberately agent-facing: no steps, locators, policy, or provenance leaked through.
    expect(balance).not.toHaveProperty('steps');
    expect(balance).not.toHaveProperty('policy');

    const order = summaries.find((s) => s.id === 'order-replacement-card');
    expect(order).toMatchObject({ approvalState: 'approved' });
  });

  it('skips a malformed artifact file rather than failing the whole listing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'catalog-test-'));
    try {
      const real = readFileSync('artifacts/member-savings-balance@1.0.0.json', 'utf-8');
      writeFileSync(path.join(dir, 'member-savings-balance@1.0.0.json'), real, 'utf-8');
      writeFileSync(path.join(dir, 'broken@1.0.0.json'), '{ this is not valid json', 'utf-8');

      const summaries = listCapabilities(dir);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.id).toBe('member-savings-balance');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('findCapability picks the highest semver when more than one version exists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'catalog-test-'));
    try {
      const real = JSON.parse(readFileSync('artifacts/member-savings-balance@1.0.0.json', 'utf-8'));
      writeFileSync(path.join(dir, 'x@1.0.0.json'), JSON.stringify({ ...real, capability: { ...real.capability, id: 'x', semver: '1.0.0' } }), 'utf-8');
      writeFileSync(path.join(dir, 'x@2.0.0.json'), JSON.stringify({ ...real, capability: { ...real.capability, id: 'x', semver: '2.0.0' } }), 'utf-8');

      expect(findCapability('x', dir)?.capability.semver).toBe('2.0.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined for an id that does not exist', () => {
    expect(findCapability('does-not-exist', 'artifacts')).toBeUndefined();
  });
});

describe('invokeCapability (real replay, real fixture)', () => {
  let server: Server;
  let baseUrl: string;
  let surface: Surface;
  let dir: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    surface = await createPlaywrightWebSurface({
      runId: 'catalog-invoke-test',
      headless: true,
      policy: { allowedOrigins: [baseUrl], allowedActions: ['navigate', 'click', 'type', 'typeCredential'] },
      credentials: { resolve: (ref) => (ref === 'FIXTURE_OPERATOR_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
    });
  }, 30000);

  afterAll(async () => {
    await surface.close();
    server.close();
  });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'catalog-invoke-'));
    const raw = readFileSync('artifacts/member-savings-balance@1.0.0.json', 'utf-8').replaceAll('http://localhost:4400', baseUrl);
    writeFileSync(path.join(dir, 'member-savings-balance@1.0.0.json'), raw, 'utf-8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('looks up a capability by id and genuinely replays it', async () => {
    const invoked = await invokeCapability('member-savings-balance', { memberId: '41382' }, {
      surface,
      runId: generateRunId('member-savings-balance'),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    }, dir);

    expect(invoked.ok).toBe(true);
    if (!invoked.ok) return;
    expect(invoked.result.status).toBe('success');
    expect(invoked.result.outputs?.savingsBalance).toBe(1204.5);
  }, 30000);

  it('reports a clear reason when no capability matches the id, without touching the surface', async () => {
    const invoked = await invokeCapability('no-such-capability', {}, {
      surface,
      runId: generateRunId('no-such-capability'),
      lease: new RunLease(),
      operatorChannel: new ConsoleOperatorChannel(),
    }, dir);

    expect(invoked).toEqual({ ok: false, reason: expect.stringContaining('no-such-capability') });
  });
});
