/**
 * Integration test: a real headless Chromium tab, driven through the fixture's actual
 * hostile markup -- not hand-built Observation fixtures. This is what proves the
 * perception layer (frameId-scoped AX trees, dom-lite textContext) and the action layer
 * (bounding-box click/type) work against a browser, not just against our own test data.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { createPlaywrightWebSurface } from '../../src/surface/playwright-surface';
import type { Surface } from '../../src/surface/surface';
import type { LocatorDescriptor } from '../../src/locator/descriptor';

function target(tier: 1 | 2 | 3, note: string, locator: LocatorDescriptor['candidates'][number]['locator']): LocatorDescriptor {
  return { candidates: [{ tier, confidence: 0.8, note, locator }], recordedTier: tier };
}

let server: Server;
let baseUrl: string;
let surface: Surface;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await createPlaywrightWebSurface({
    runId: 'integration-test',
    headless: true,
    policy: { allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate', 'click', 'type', 'typeCredential', 'read'] },
    credentials: { resolve: (ref) => (ref === 'TEST_PASSWORD' ? 'fixture-only-not-a-real-secret' : '') },
  });
}, 30000);

afterAll(async () => {
  await surface.close();
  server.close();
});

describe('PlaywrightWebSurface against the real fixture', () => {
  it('logs in, searches by label-proximity on an unlabeled field, and reads a real balance', async () => {
    const nav = await surface.act({ kind: 'navigate', url: `${baseUrl}/login` });
    expect(nav.ok).toBe(true);

    // The username field has a real <label for> -- should resolve at tier 1.
    const usernameResult = await surface.act({
      kind: 'type',
      target: target(1, 'real label', { strategy: 'roleAndName', role: 'textbox', name: 'Username' }),
      text: 'svc.operator',
    });
    expect(usernameResult).toMatchObject({ ok: true, resolvedTier: 1 });

    // The password field has NO label -- only its adjacent "Password" table cell.
    // role:'textbox' is required here: the label cell and the row itself also carry
    // "Password" in their own textContext (same heuristic, applied to every node), so
    // an unconstrained label-proximity match is genuinely ambiguous across three nodes.
    const passwordResult = await surface.act({
      kind: 'typeCredential',
      target: target(2, 'adjacent cell only, no label', {
        strategy: 'labelProximity',
        labelText: 'Password',
        direction: 'right',
        role: 'textbox',
      }),
      credentialRef: 'TEST_PASSWORD',
    });
    expect(passwordResult).toMatchObject({ ok: true, resolvedTier: 2 });

    const loginResult = await surface.act({
      kind: 'click',
      target: target(1, 'real <button>', { strategy: 'roleAndName', role: 'button', name: 'Log In' }),
    });
    expect(loginResult).toMatchObject({ ok: true, resolvedTier: 1 });

    const afterLogin = await surface.observe();
    expect(afterLogin.url).toContain('/app');

    // The member-ID field carries no accessible name at all -- proves textContext
    // (built from a real DOM.getDocument tree, not hand-built test data) actually works.
    const idResult = await surface.act({
      kind: 'type',
      target: target(2, 'unlabeled field, adjacent cell text only', {
        strategy: 'labelProximity',
        labelText: 'Member ID',
        direction: 'right',
        role: 'textbox',
      }),
      text: '41382',
    });
    expect(idResult).toMatchObject({ ok: true, resolvedTier: 2 });

    // The "Search" control is a <td onclick> -- its real Chrome role is LayoutTableCell,
    // not button, so it can only resolve via visible text, not role+name. framePath is
    // required here: the nav frame's "Search Members" link also contains "Search", so
    // an unscoped visibleText match across both frames is genuinely ambiguous.
    const searchClick = await surface.act({
      kind: 'click',
      target: target(3, 'onclick table cell, no semantic role', {
        strategy: 'visibleText',
        text: 'Search',
        framePath: ['content'],
      }),
    });
    expect(searchClick).toMatchObject({ ok: true, resolvedTier: 3 });

    const memberObs = await surface.observe();
    expect(memberObs.nodes.some((n) => n.name.includes('Alice Johnson'))).toBe(true);

    const balanceRead = await surface.act({
      kind: 'read',
      target: target(2, 'balance cell, identified by its row label', {
        strategy: 'labelProximity',
        labelText: 'Savings',
        direction: 'right',
        role: 'cell',
      }),
      source: 'text',
    });
    expect(balanceRead.ok).toBe(true);
    if (balanceRead.ok) expect(balanceRead.value).toContain('1204.50');
  }, 30000);

  it('rejects an action outside the current policy before touching the page', async () => {
    surface.setPolicy({ allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate'] }); // click not permitted
    const result = await surface.act({
      kind: 'click',
      target: target(1, 'irrelevant -- should be denied before resolution', { strategy: 'roleAndName', role: 'button', name: 'Log In' }),
    });
    expect(result).toMatchObject({ ok: false, reason: 'policy_denied' });

    // Restore, in case this file's test order ever changes.
    surface.setPolicy({ allowedOrigins: [new URL(baseUrl).origin], allowedActions: ['navigate', 'click', 'type', 'typeCredential', 'read'] });
  });
});
