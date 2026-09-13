import { describe, expect, it } from 'vitest';
import { classifyRisk, detectExistingOutcomeWarning } from '../../src/policy/risk';
import type { Action } from '../../src/surface/action';
import type { LocatorDescriptor } from '../../src/locator/descriptor';
import type { Observation, ObservedNode } from '../../src/surface/observation';

function target(strategy: LocatorDescriptor['candidates'][number]['locator']): LocatorDescriptor {
  const tier = strategy.strategy === 'roleAndName' ? 1 : strategy.strategy === 'labelProximity' ? 2 : 3;
  return { recordedTier: tier, candidates: [{ tier, confidence: 0.9, note: 'test candidate', locator: strategy }] };
}

function node(overrides: Partial<ObservedNode> = {}): ObservedNode {
  return { nodeId: 'n', role: 'text', name: '', enabled: true, visible: true, framePath: [], ...overrides };
}

function obs(nodes: ObservedNode[]): Observation {
  return { runId: 'r1', seq: 0, url: 'http://x', title: '', nodes, hash: 'h', capturedAt: '2026-01-01T00:00:00Z' };
}

describe('classifyRisk', () => {
  it('treats navigate/type/select/read as always safe', () => {
    const nonClicks: Action[] = [
      { kind: 'navigate', url: 'http://x/confirm-order' },
      { kind: 'type', target: target({ strategy: 'visibleText', text: 'Delete everything' }), text: 'x' },
      { kind: 'select', target: target({ strategy: 'visibleText', text: 'Transfer' }), option: 'y' },
      { kind: 'read', target: target({ strategy: 'visibleText', text: 'Withdraw' }), source: 'text' },
    ];
    for (const action of nonClicks) expect(classifyRisk(action)).toBe('safe');
  });

  it('classifies a click on a plainly state-changing label as irreversible', () => {
    const risky = ['Confirm Order', 'Submit', 'Delete Account', 'Transfer Funds', 'Approve', 'Send Payment'];
    for (const name of risky) {
      const action: Action = { kind: 'click', target: target({ strategy: 'roleAndName', role: 'button', name }) };
      expect(classifyRisk(action)).toBe('irreversible');
    }
  });

  it('classifies a click on an ordinary navigational label as safe', () => {
    const safe = ['Search', 'View Member', 'Back', 'Next'];
    for (const name of safe) {
      const action: Action = { kind: 'click', target: target({ strategy: 'roleAndName', role: 'button', name }) };
      expect(classifyRisk(action)).toBe('safe');
    }
  });

  it('reads label text from labelProximity and visibleText candidates too, not just roleAndName', () => {
    const viaLabel: Action = { kind: 'click', target: target({ strategy: 'labelProximity', labelText: 'Remove card', direction: 'right' }) };
    const viaVisible: Action = { kind: 'click', target: target({ strategy: 'visibleText', text: 'Pay now' }) };
    expect(classifyRisk(viaLabel)).toBe('irreversible');
    expect(classifyRisk(viaVisible)).toBe('irreversible');
  });
});

describe('detectExistingOutcomeWarning', () => {
  it('finds an "already ordered" style notice by its name', () => {
    const n = node({ name: 'A replacement card was already ordered. Reference REF-32884.' });
    expect(detectExistingOutcomeWarning(obs([n]))).toContain('REF-32884');
  });

  it('finds the notice via textContext, not just the node name', () => {
    const n = node({ name: '', textContext: 'Notice: already approved on 2026-01-01.' });
    expect(detectExistingOutcomeWarning(obs([n]))).toContain('already approved');
  });

  it('finds the notice via value', () => {
    const n = node({ role: 'textbox', name: '', value: 'Status: already submitted' });
    expect(detectExistingOutcomeWarning(obs([n]))).toContain('already submitted');
  });

  it('returns undefined when no node mentions a prior outcome', () => {
    const nodes = [node({ name: 'Order a replacement card for Alice Johnson (41382)?' }), node({ name: 'Confirm Order', role: 'button' })];
    expect(detectExistingOutcomeWarning(obs(nodes))).toBeUndefined();
  });

  it('does not match "order" alone -- only an explicit "already ..." phrasing', () => {
    const n = node({ name: 'Order Replacement Card' });
    expect(detectExistingOutcomeWarning(obs([n]))).toBeUndefined();
  });
});
