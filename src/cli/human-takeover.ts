/**
 * The console's side of a real human takeover, shared by every CLI that can pause on a
 * lease (discover, replay): once the lease reports PAUSED_PENDING_HUMAN, this prompts on
 * stdin and blocks until the operator at the keyboard presses Enter -- at which point it
 * claims and releases the lease itself, exactly as a real operator console would after a
 * person finishes acting in the open browser window. Runs concurrently with whatever
 * paused, polling rather than blocking it, since the escalation notification
 * (ConsoleOperatorChannel) must not itself wait on this -- it only announces the request.
 */
import { createInterface } from 'node:readline/promises';
import type { RunLease } from '../session/lease';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function watchForHumanTakeover(lease: RunLease, isRunning: () => boolean): Promise<void> {
  let prompted = false;
  while (isRunning()) {
    if (lease.state === 'PAUSED_PENDING_HUMAN' && !prompted) {
      prompted = true;
      const intervention = lease.getIntervention();
      console.log(`\n>>> A human is needed: ${intervention?.reason}`);
      console.log('>>> Complete the action yourself in the open browser window, then press Enter here to resume automation.');

      // Cancels the prompt the moment the lease resolves on its own (the escalation
      // window elapsing), so a slow or absent human never leaves this hanging forever.
      const abortPrompt = new AbortController();
      const stopWatchingForAbort = (async () => {
        while (lease.state === 'PAUSED_PENDING_HUMAN' && isRunning()) await delay(150);
        abortPrompt.abort();
      })();

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await rl.question('Press Enter once done (or wait for the escalation timeout) > ', { signal: abortPrompt.signal });
        if (lease.state === 'PAUSED_PENDING_HUMAN') {
          lease.takeControl();
          lease.releaseControl();
        }
      } catch {
        // the lease resolved on its own before Enter was pressed -- nothing to do
      } finally {
        rl.close();
        await stopWatchingForAbort;
      }
    }
    if (lease.state === 'AUTOMATION') prompted = false;
    if (lease.state === 'ABORTED') return;
    await delay(150);
  }
}
