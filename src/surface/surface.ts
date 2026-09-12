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
import type { Allowlist } from '../policy/allowlist';

/** A pointer to what capture() produced. */
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
  /** The allowlist an act() call is checked against, from now until the next call. Any caller driving this Surface gets the same guardrail, not just the one that remembered to check it. */
  setPolicy(policy: Allowlist): void;
  /** Which run this Surface is currently acting for -- tags observe()'s output and where capture() saves evidence. Lets one Surface instance run several artifacts in sequence without its evidence landing under the wrong run's folder. */
  setRunId(runId: string): void;
  capture(): Promise<EvidenceRef>;
  close(): Promise<void>;
}
