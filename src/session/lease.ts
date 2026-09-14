/**
 * Who controls the live session, and the seam automation pauses/resumes through.
 * Per-run instance, never a singleton -- constructed fresh per replay() call, same as
 * the evidence writer.
 *
 * AUTOMATION -> PAUSED_PENDING_HUMAN -> HUMAN_CONTROL -> RESUMING -> AUTOMATION
 *                                                                 -> ABORTED
 *
 * A real, separate operator console would need this shared across processes (a socket,
 * a small local server) -- out of scope here. What's real is the state machine itself:
 * an operator process would call takeControl()/releaseControl() on this same object: in
 * this build, a caller in the same process rather than a websocket, but the transitions
 * and the executor's blocking behavior around them are exactly what a real one would need.
 */
export type LeaseState = 'AUTOMATION' | 'PAUSED_PENDING_HUMAN' | 'HUMAN_CONTROL' | 'RESUMING' | 'ABORTED';

export interface InterventionRequest {
  runId: string;
  capability: string;
  stepId: string;
  intent: string;
  reason: string;
  raisedAt: string;
  /** Screenshot path from Surface.capture(), best-effort -- the operator's view of the state that triggered this. */
  evidenceRef: string;
}

export type HandoffOutcome = 'resumed' | 'timeout';

export class RunLease {
  private _state: LeaseState = 'AUTOMATION';
  private intervention: InterventionRequest | undefined;
  private resolveWait: ((outcome: HandoffOutcome) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  get state(): LeaseState {
    return this._state;
  }

  getIntervention(): InterventionRequest | undefined {
    return this.intervention;
  }

  /**
   * Automation asks to hand off. Resolves 'resumed' once a human calls releaseControl(),
   * or 'timeout' if nobody does within timeoutMs -- a clean failure the caller can route
   * around beats an indefinite hold, and an unbounded headed browser is a resource leak
   * at any real scale.
   */
  requestHandoff(request: InterventionRequest, timeoutMs: number): Promise<HandoffOutcome> {
    if (this._state !== 'AUTOMATION') {
      throw new Error(`cannot request handoff from state ${this._state}`);
    }
    this._state = 'PAUSED_PENDING_HUMAN';
    this.intervention = request;
    return new Promise((resolve) => {
      this.resolveWait = resolve;
      this.timer = setTimeout(() => {
        if (this._state === 'PAUSED_PENDING_HUMAN' || this._state === 'HUMAN_CONTROL') {
          this._state = 'ABORTED';
          this.resolveWait = undefined;
          resolve('timeout');
        }
      }, timeoutMs);
    });
  }

  /** A human claims the session. */
  takeControl(): void {
    if (this._state !== 'PAUSED_PENDING_HUMAN') {
      throw new Error(`cannot take control from state ${this._state}`);
    }
    this._state = 'HUMAN_CONTROL';
  }

  /** A human signals they're done. Automation is not yet back in control -- confirmResumed() does that, after re-verifying state. */
  releaseControl(): void {
    if (this._state !== 'HUMAN_CONTROL') {
      throw new Error(`cannot release control from state ${this._state}`);
    }
    this._state = 'RESUMING';
    clearTimeout(this.timer);
    const resolve = this.resolveWait;
    this.resolveWait = undefined;
    resolve?.('resumed');
  }

  /** Automation has re-observed and confirmed the current step's checkpoint still holds. */
  confirmResumed(): void {
    if (this._state !== 'RESUMING') {
      throw new Error(`cannot confirm resume from state ${this._state}`);
    }
    this._state = 'AUTOMATION';
  }

  /** Also resolves a pending requestHandoff() as 'timeout' -- otherwise an external abort would leave that caller waiting forever. */
  abort(): void {
    clearTimeout(this.timer);
    this._state = 'ABORTED';
    const resolve = this.resolveWait;
    this.resolveWait = undefined;
    resolve?.('timeout');
  }
}
