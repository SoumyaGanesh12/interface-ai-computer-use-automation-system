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
import { EnvCredentialProvider, type CredentialProvider } from '../policy/credentials';
import type { Allowlist } from '../policy/allowlist';
import { runEvidenceDir } from '../evidence/paths';
import type { Action, ActionResult } from './action';
import type { Observation } from './observation';
import type { EvidenceRef, Surface } from './surface';

export interface PlaywrightSurfaceOptions {
  runId: string;
  /** No permissive default: an unconfigured surface can act on nothing, not everything. */
  policy: Allowlist;
  headless?: boolean;
  /** Overrides the derived evidence directory entirely; otherwise derived from the current runId. */
  evidenceDir?: string;
  credentials?: CredentialProvider;
}

export async function createPlaywrightWebSurface(opts: PlaywrightSurfaceOptions): Promise<Surface> {
  const browser: Browser = await chromium.launch({ headless: opts.headless ?? false });
  const page: Page = await browser.newPage();
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Page.enable');

  let seq = 0;
  let policy = opts.policy;
  let runId = opts.runId;
  const credentials = opts.credentials ?? new EnvCredentialProvider();

  return {
    async observe(): Promise<Observation> {
      const { observation } = await perceive(page, cdp, runId, seq++);
      return observation;
    },

    async act(action: Action): Promise<ActionResult> {
      return performAction(page, cdp, runId, seq++, action, credentials, policy);
    },

    setPolicy(next: Allowlist): void {
      policy = next;
    },

    setRunId(next: string): void {
      runId = next;
    },

    async capture(): Promise<EvidenceRef> {
      const dir = opts.evidenceDir ?? runEvidenceDir(runId);
      await mkdir(dir, { recursive: true });
      // Fixed names, not timestamped: today a run captures at most once (its terminal
      // failure). This will need a per-capture suffix once escalation can also
      // capture mid-run -- more than one capture per run would silently overwrite.
      const screenshotPath = path.join(dir, 'screenshot.png');
      const domSnapshotPath = path.join(dir, 'snapshot.html');
      await page.screenshot({ path: screenshotPath });
      await writeFile(domSnapshotPath, await page.content(), 'utf-8');
      return { runId, screenshotPath, domSnapshotPath, capturedAt: new Date().toISOString() };
    },

    async close(): Promise<void> {
      await browser.close();
    },
  };
}
