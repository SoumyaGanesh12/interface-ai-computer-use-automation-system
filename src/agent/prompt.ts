/**
 * Full action history (compact), but only the current observation -- stale
 * observations are dead weight the model has to read past, and it also means discovery
 * consumes observations at exactly the scale replay does.
 */
import type { Observation } from '../surface/observation';

export interface HistoryEntry {
  intent: string;
  actionSummary: string;
  result: 'ok' | 'failed';
  detail?: string;
  readValue?: string;
}

const SCHEMA_DESCRIPTION = `Return exactly one JSON object, no prose, no markdown fence, matching this shape:

{
  "rationale": string,            // required, non-empty: why you're making this decision
  "intent": string,                // required: a short imperative description of this step
  "decision": one of:
    { "kind": "act", "action": one of:
      { "actionKind": "navigate", "url": string }
      { "actionKind": "click", "targetNodeId": string }
      { "actionKind": "type", "targetNodeId": string, "text": string }
      { "actionKind": "select", "targetNodeId": string, "option": string }
      { "actionKind": "read", "targetNodeId": string, "source": "text" | "value" }
    }
    { "kind": "done", "outputs": { [name: string]: string } }
    { "kind": "stuck", "reason": string }
}

"targetNodeId" must be the exact "id" field of a node from the CURRENT OBSERVATION below.
Only ever pick a node that is currently visible and enabled.`;

export function buildPrompt(goal: string, history: HistoryEntry[], observation: Observation): string {
  const historyText = history.length
    ? history
        .map((h, i) => `${i + 1}. intent: ${h.intent} | action: ${h.actionSummary} | result: ${h.result}${h.detail ? ` (${h.detail})` : ''}${h.readValue ? ` | read: "${h.readValue}"` : ''}`)
        .join('\n')
    : '(none yet -- this is the first step)';

  const nodesText = observation.nodes
    .map((n) => {
      const parts = [`id=${n.nodeId}`, `role=${n.role}`, `name="${n.name}"`];
      if (n.value !== undefined) parts.push(`value="${n.value}"`);
      if (n.textContext) parts.push(`nearby="${n.textContext}"`);
      if (n.framePath.length) parts.push(`frame=${n.framePath.join('/')}`);
      if (!n.visible) parts.push('HIDDEN');
      if (!n.enabled) parts.push('DISABLED');
      return `  ${parts.join(' ')}`;
    })
    .join('\n');

  return `You are operating a web UI to accomplish a goal. You cannot see a screenshot -- only the
structured list of elements below, exactly as a screen reader would expose them.

GOAL: ${goal}

${SCHEMA_DESCRIPTION}

ACTION HISTORY SO FAR:
${historyText}

CURRENT PAGE:
url: ${observation.url}
title: ${observation.title}
nodes:
${nodesText}

Decide the next single action, or "done" if the goal is already achieved (read any
requested values into "outputs" first), or "stuck" if you cannot proceed.`;
}
