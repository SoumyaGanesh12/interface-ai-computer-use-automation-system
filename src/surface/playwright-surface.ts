/**
 * The one Surface implementation for this build: a real headed Chromium tab, driven via
 * Playwright + one CDP session. Headed by default -- human takeover (later) needs an
 * operable window, not a screenshot of one. Tests pass `headless: true` for speed.
 */
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { perceive } from './perceive';
import { performAction } from './act';
import type { Action, ActionResult } from './action';
import type { Observation } from './observation';
import type { EvidenceRef, Surface } from './surface';

export interface PlaywrightSurfaceOptions {
  runId: string;
  headless?: boolean;
  evidenceDir?: string;
  /**
   * Temporary: credentialRef is read as an env var name directly. Phase 4's
   * CredentialProvider formalizes injection at session start; this keeps the seam (a
   * reference resolved inside the surface, never a literal in an action or artifact)
   * real today without blocking on work that hasn't happened yet.
   */
  resolveCredential?: (ref: string) => string;
}

export async function createPlaywrightWebSurface(opts: PlaywrightSurfaceOptions): Promise<Surface> {
  const browser: Browser = await chromium.launch({ headless: opts.headless ?? false });
  const page: Page = await browser.newPage();
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Page.enable');

  let seq = 0;
  const evidenceDir = opts.evidenceDir ?? path.join('evidence', opts.runId);
  const resolveCredential = opts.resolveCredential ?? ((ref: string) => process.env[ref] ?? '');

  return {
    async observe(): Promise<Observation> {
      const { observation } = await perceive(page, cdp, opts.runId, seq++);
      return observation;
    },

    async act(action: Action): Promise<ActionResult> {
      return performAction(page, cdp, opts.runId, seq++, action, resolveCredential);
    },

    async capture(): Promise<EvidenceRef> {
      await mkdir(evidenceDir, { recursive: true });
      const stamp = Date.now();
      const screenshotPath = path.join(evidenceDir, `${stamp}.png`);
      const domSnapshotPath = path.join(evidenceDir, `${stamp}.html`);
      await page.screenshot({ path: screenshotPath });
      await writeFile(domSnapshotPath, await page.content(), 'utf-8');
      return { runId: opts.runId, screenshotPath, domSnapshotPath, capturedAt: new Date().toISOString() };
    },

    async close(): Promise<void> {
      await browser.close();
    },
  };
}
