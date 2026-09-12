/**
 * The one seam between "how we perceive/act on a surface" and everything above it.
 * PlaywrightWebSurface implements this for the web fixture; a desktop adapter would
 * implement the same contract over UI Automation without changing a caller.
 *
 * A plain interface, not a Zod schema: unlike Observation/Action, a Surface is behavior,
 * not data that crosses a disk boundary.
 */
import type { Action, ActionResult } from './action';
import type { Observation } from './observation';

/** A pointer to what capture() produced -- expanded once the evidence writer exists. */
export interface EvidenceRef {
  runId: string;
  screenshotPath: string;
  domSnapshotPath?: string;
  capturedAt: string;
}

export interface Surface {
  observe(): Promise<Observation>;
  /** The single policy choke point: every dispatched action passes through here. */
  act(action: Action): Promise<ActionResult>;
  capture(): Promise<EvidenceRef>;
  close(): Promise<void>;
}
