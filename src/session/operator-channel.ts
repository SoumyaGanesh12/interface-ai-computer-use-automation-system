/**
 * How an intervention request reaches a human. One implementation here (stdout); a web
 * console would implement the same interface without the executor or the lease
 * changing at all.
 */
import type { InterventionRequest } from './lease';

export interface OperatorChannel {
  notify(request: InterventionRequest): Promise<void>;
}

export class ConsoleOperatorChannel implements OperatorChannel {
  async notify(request: InterventionRequest): Promise<void> {
    const evidenceLine = request.evidenceRef ? `\n  state: ${request.evidenceRef}` : '';
    console.log(
      `\n[intervention needed] run=${request.runId} capability=${request.capability} step=${request.stepId}\n  intent: ${request.intent}\n  reason: ${request.reason}${evidenceLine}\n`,
    );
  }
}
