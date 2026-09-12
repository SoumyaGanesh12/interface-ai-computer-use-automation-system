/**
 * What gets recorded while a human has the session: event type and a structural target
 * identifier only. Never a typed value -- the listener that produces these deliberately
 * never reads an input's `.value`.
 */
export interface HumanAction {
  type: string;
  targetTag: string;
  targetName: string;
  at: string;
}
