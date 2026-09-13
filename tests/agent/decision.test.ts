import { describe, expect, it } from 'vitest';
import { AgentDecisionSchema } from '../../src/agent/decision';

describe('AgentDecisionSchema', () => {
  it('parses an act/click decision', () => {
    const parsed = AgentDecisionSchema.safeParse({
      rationale: 'the search button is visible and the member id is already entered',
      intent: 'submit the search',
      decision: { kind: 'act', action: { actionKind: 'click', targetNodeId: 'n42' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('parses a done decision carrying outputs', () => {
    const parsed = AgentDecisionSchema.safeParse({
      rationale: 'the savings balance is now visible on the member page',
      intent: 'report the balance',
      decision: { kind: 'done', outputs: { savingsBalance: '1204.50' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('parses a stuck decision with a reason', () => {
    const parsed = AgentDecisionSchema.safeParse({
      rationale: 'no path forward is visible after three attempts',
      intent: 'give up',
      decision: { kind: 'stuck', reason: 'the member search returned no results and no further action is possible' },
    });
    expect(parsed.success).toBe(true);
  });

  it('defaults a read action\'s source to "text" when omitted', () => {
    const parsed = AgentDecisionSchema.safeParse({
      rationale: 'the balance is displayed as text in this cell',
      intent: 'read the balance',
      decision: { kind: 'act', action: { actionKind: 'read', targetNodeId: 'n7' } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.decision.kind === 'act' && parsed.data.decision.action.actionKind === 'read') {
      expect(parsed.data.decision.action.source).toBe('text');
    }
  });

  it('rejects a decision with an empty rationale', () => {
    const parsed = AgentDecisionSchema.safeParse({
      rationale: '',
      intent: 'submit the search',
      decision: { kind: 'act', action: { actionKind: 'click', targetNodeId: 'n42' } },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown decision kind', () => {
    const parsed = AgentDecisionSchema.safeParse({
      rationale: 'x',
      intent: 'y',
      decision: { kind: 'wander', reason: 'not a real decision kind' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a navigate action missing its url', () => {
    const parsed = AgentDecisionSchema.safeParse({
      rationale: 'x',
      intent: 'y',
      decision: { kind: 'act', action: { actionKind: 'navigate' } },
    });
    expect(parsed.success).toBe(false);
  });
});
