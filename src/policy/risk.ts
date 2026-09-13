/**
 * Classifies a candidate click as safe or irreversible when nothing has already
 * declared its risk (an artifact step always has; a live discovery decision never does).
 *
 * This is a coarse keyword heuristic on the target's own locator text, not semantic
 * understanding -- stated plainly rather than oversold. A real deployment would want a
 * per-app configurable pattern list at minimum, and ideally the model's own judgment
 * cross-checked against it; this is the honest, cheap version of that idea.
 */
import type { Action } from '../surface/action';
import type { LocatorDescriptor } from '../locator/descriptor';
import type { Observation } from '../surface/observation';

const RISKY_PATTERN = /confirm|submit|delete|remove|order|transfer|pay|withdraw|approve|send|close account/i;

function candidateText(target: LocatorDescriptor): string {
  return target.candidates
    .map((c) => {
      const l = c.locator;
      if (l.strategy === 'roleAndName') return l.name;
      if (l.strategy === 'labelProximity') return l.labelText;
      if (l.strategy === 'visibleText') return l.text;
      return '';
    })
    .join(' ');
}

export function classifyRisk(action: Action): 'safe' | 'irreversible' {
  if (action.kind !== 'click') return 'safe';
  return RISKY_PATTERN.test(candidateText(action.target)) ? 'irreversible' : 'safe';
}

const EXISTING_OUTCOME_PATTERN = /already (ordered|submitted|placed|approved|processed|confirmed|paid|sent|completed|exists)/i;

/**
 * A coarse scan of the current observation for text suggesting the irreversible action
 * about to be escalated may be a duplicate -- e.g. a page's own "already ordered" notice.
 * Only sees what's on the current page, not any history the model or a human hasn't
 * been shown; the same honest limitation as classifyRisk, not semantic understanding.
 * Exists so an escalation surfaces this directly, rather than depending on the model to
 * volunteer it in its own rationale (it doesn't always).
 */
export function detectExistingOutcomeWarning(observation: Observation): string | undefined {
  for (const node of observation.nodes) {
    const text = [node.name, node.value, node.textContext].filter(Boolean).join(' ').trim();
    if (text && EXISTING_OUTCOME_PATTERN.test(text)) return text;
  }
  return undefined;
}
