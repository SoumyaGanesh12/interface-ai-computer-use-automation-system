/**
 * Proves the fixture itself -- not just the automation calling it -- refuses to place a
 * second card order for a member who already has one. Found by hand: clicking "Confirm
 * Order" twice through the raw browser UI (bypassing the automation entirely) used to
 * silently overwrite the first order with a second, fresh reference. The automation's own
 * precheck (tests/replay/idempotency.test.ts) only ever protected the automation from
 * double-submitting itself; it did nothing for a human, or any other caller, hitting this
 * same endpoint directly. This is the fixture's own source of truth being fixed instead.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { findOrder } from '../../fixture/orders';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

async function login(): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ f_a1: 'svc.operator', f_a2: 'fixture-only-not-a-real-secret' }).toString(),
    redirect: 'manual',
  });
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('login did not set a session cookie');
  return cookie;
}

async function postCardOrder(memberId: string, cookie: string): Promise<string> {
  const res = await fetch(`${baseUrl}/card/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ id: memberId }).toString(),
  });
  const body = await res.text();
  const match = /REF-\d+/.exec(body);
  if (!match) throw new Error(`no confirmation reference found in response: ${body}`);
  return match[0];
}

describe('POST /card/order', () => {
  it('placing a second order for the same member returns the existing reference, not a new one', async () => {
    const memberId = '41382';
    const cookie = await login();
    const first = await postCardOrder(memberId, cookie);
    expect(first).toMatch(/^REF-\d+$/);

    const second = await postCardOrder(memberId, cookie);
    expect(second).toBe(first);

    // The store itself was never overwritten -- not just that the two HTTP responses agreed.
    expect(findOrder(memberId)?.reference).toBe(first);
  });
});

describe('GET /card/order', () => {
  it('no longer offers a clickable Confirm Order once the member already has an order', async () => {
    const memberId = '77410';
    const cookie = await login();
    await postCardOrder(memberId, cookie);

    const res = await fetch(`${baseUrl}/card/order?id=${memberId}`, { headers: { cookie } });
    const body = await res.text();

    expect(body).toContain('already ordered');
    // The real proof: not just that a notice is shown, but that the form a person could
    // still click through to resubmit is gone entirely.
    expect(body).not.toContain('Confirm Order');
    expect(body).not.toContain('<form');
  });
});
