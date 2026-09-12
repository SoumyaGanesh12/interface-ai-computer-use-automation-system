/**
 * Tests createHumanActionRecorder directly against a real page -- a human doesn't call
 * Surface.act(), they use the browser, so this is verified at the level a real hand
 * actually touches: real Playwright interactions on a real (frameset) page.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../fixture/app';
import { createHumanActionRecorder } from '../../src/surface/human-recorder';

let server: Server;
let baseUrl: string;
let browser: Browser;
let page: Page;
let recorder: ReturnType<typeof createHumanActionRecorder>;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  // One recorder per page, matching real usage (one per Surface): exposeFunction is
  // page-scoped, so a second recorder on the same page can't rebind it.
  recorder = createHumanActionRecorder(page);
}, 30000);

afterAll(async () => {
  await browser.close();
  server.close();
});

describe('createHumanActionRecorder', () => {
  it('records a click and an input change, but never the typed value', async () => {
    await page.goto(`${baseUrl}/login`);

    await recorder.begin();
    await page.fill('#uname', 'svc.operator');
    await page.click('button[type=submit]');
    await page.waitForTimeout(50); // let the exposed-function round trip land before end()
    const actions = await recorder.end();

    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions.some((a) => a.type === 'input')).toBe(true);
    expect(actions.some((a) => a.type === 'click')).toBe(true);

    const serialized = JSON.stringify(actions);
    expect(serialized).not.toContain('svc.operator');
  }, 15000);

  it('captures actions in a child frame, not just the top document', async () => {
    // Log in first so the frameset (nav + content) is what's loaded.
    await page.goto(`${baseUrl}/login`);
    await page.fill('#uname', 'svc.operator');
    await page.fill('input[name="f_a2"]', 'fixture-only-not-a-real-secret');
    await page.click('button[type=submit]');
    await page.waitForURL(/\/app/);

    await recorder.begin();

    const navFrame = page.frames().find((f) => f.name() === 'nav');
    expect(navFrame).toBeTruthy();
    await navFrame!.click('text=Search Members');
    await page.waitForTimeout(50);

    const actions = await recorder.end();
    expect(actions.some((a) => a.type === 'click')).toBe(true);
  }, 15000);
});
