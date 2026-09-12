import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/matcher/evaluate';
import type { Matcher } from '../../src/matcher/types';
import type { LocatorDescriptor } from '../../src/locator/descriptor';
import type { Observation, ObservedNode } from '../../src/surface/observation';

function node(overrides: Partial<ObservedNode> = {}): ObservedNode {
  return { nodeId: 'n', role: 'button', name: '', enabled: true, visible: true, framePath: [], ...overrides };
}

function obs(nodes: ObservedNode[], url = 'http://x/page'): Observation {
  return { runId: 'r1', seq: 0, url, title: 'Page', nodes, hash: 'h', capturedAt: '2026-01-01T00:00:00Z' };
}

function target(name: string, role: ObservedNode['role'] = 'button'): LocatorDescriptor {
  return { candidates: [{ tier: 1, confidence: 0.9, note: 'test target', locator: { strategy: 'roleAndName', role, name } }], recordedTier: 1 };
}

describe('evaluate: nodeExists / nodeAbsent', () => {
  it('nodeExists is satisfied for a resolved, visible node', () => {
    expect(evaluate({ kind: 'nodeExists', target: target('Confirm') }, obs([node({ name: 'Confirm' })])).satisfied).toBe(true);
  });

  it('nodeExists is satisfied even when the node is disabled', () => {
    expect(evaluate({ kind: 'nodeExists', target: target('Confirm') }, obs([node({ name: 'Confirm', enabled: false })])).satisfied).toBe(true);
  });

  it('nodeExists is NOT satisfied when ambiguous -- never a coin flip', () => {
    const nodes = [node({ nodeId: 'a', name: 'Confirm' }), node({ nodeId: 'b', name: 'Confirm' })];
    expect(evaluate({ kind: 'nodeExists', target: target('Confirm') }, obs(nodes)).satisfied).toBe(false);
  });

  it('nodeAbsent is NOT satisfied when ambiguous', () => {
    const nodes = [node({ nodeId: 'a', name: 'Confirm' }), node({ nodeId: 'b', name: 'Confirm' })];
    expect(evaluate({ kind: 'nodeAbsent', target: target('Confirm') }, obs(nodes)).satisfied).toBe(false);
  });

  it('nodeAbsent is satisfied when nothing matches', () => {
    expect(evaluate({ kind: 'nodeAbsent', target: target('Ghost') }, obs([node({ name: 'Confirm' })])).satisfied).toBe(true);
  });

  it('nodeAbsent is satisfied when the node is hidden', () => {
    expect(evaluate({ kind: 'nodeAbsent', target: target('Confirm') }, obs([node({ name: 'Confirm', visible: false })])).satisfied).toBe(true);
  });
});

describe('evaluate: nodeValue', () => {
  it('eq / neq / nonEmpty', () => {
    const o = obs([node({ role: 'textbox', name: 'Member ID', value: '41382' })]);
    const t = target('Member ID', 'textbox');
    expect(evaluate({ kind: 'nodeValue', target: t, op: 'eq', value: '41382' }, o).satisfied).toBe(true);
    expect(evaluate({ kind: 'nodeValue', target: t, op: 'neq', value: '00000' }, o).satisfied).toBe(true);
    expect(evaluate({ kind: 'nodeValue', target: t, op: 'nonEmpty' }, o).satisfied).toBe(true);
  });

  it('matches applies a regex, and an invalid pattern fails closed rather than throwing', () => {
    const o = obs([node({ role: 'textbox', name: 'Balance', value: '$1,204.50' })]);
    const t = target('Balance', 'textbox');
    expect(evaluate({ kind: 'nodeValue', target: t, op: 'matches', value: '^\\$[0-9,.]+$' }, o).satisfied).toBe(true);
    expect(() => evaluate({ kind: 'nodeValue', target: t, op: 'matches', value: '(' }, o)).not.toThrow();
    expect(evaluate({ kind: 'nodeValue', target: t, op: 'matches', value: '(' }, o).satisfied).toBe(false);
  });

  it('is not satisfied when the target does not resolve', () => {
    const o = obs([node({ name: 'Other' })]);
    expect(evaluate({ kind: 'nodeValue', target: target('Missing'), op: 'nonEmpty' }, o).satisfied).toBe(false);
  });
});

describe('evaluate: textPresent', () => {
  it('scope "page" searches across all nodes', () => {
    const o = obs([node({ role: 'text', name: 'No records found for member 99999' })]);
    expect(evaluate({ kind: 'textPresent', scope: 'page', pattern: 'no records found', flags: 'i' }, o).satisfied).toBe(true);
  });

  it('a scoped LocatorDescriptor searches only that node', () => {
    const o = obs([node({ role: 'text', name: 'Balance: $500' }), node({ nodeId: 'other', role: 'text', name: 'unrelated' })]);
    expect(evaluate({ kind: 'textPresent', scope: target('Balance: $500', 'text'), pattern: '\\$500' }, o).satisfied).toBe(true);
  });
});

describe('evaluate: urlMatches', () => {
  it('tests the observation url', () => {
    expect(evaluate({ kind: 'urlMatches', pattern: '/member\\?id=41382$' }, obs([], 'http://x/member?id=41382')).satisfied).toBe(true);
    expect(evaluate({ kind: 'urlMatches', pattern: '/member\\?id=41382$' }, obs([], 'http://x/search')).satisfied).toBe(false);
  });
});

describe('evaluate: all / any / not composition', () => {
  const present: Matcher = { kind: 'nodeExists', target: target('Confirm') };
  const absent: Matcher = { kind: 'nodeExists', target: target('Ghost') };
  const sample = obs([node({ name: 'Confirm' })]);

  it('all requires every child satisfied', () => {
    expect(evaluate({ kind: 'all', of: [present, present] }, sample).satisfied).toBe(true);
    expect(evaluate({ kind: 'all', of: [present, absent] }, sample).satisfied).toBe(false);
  });

  it('any requires at least one child satisfied', () => {
    expect(evaluate({ kind: 'any', of: [absent, present] }, sample).satisfied).toBe(true);
    expect(evaluate({ kind: 'any', of: [absent, absent] }, sample).satisfied).toBe(false);
  });

  it('not negates its child', () => {
    expect(evaluate({ kind: 'not', of: present }, sample).satisfied).toBe(false);
    expect(evaluate({ kind: 'not', of: absent }, sample).satisfied).toBe(true);
  });

  it('composes to arbitrary depth', () => {
    const deep: Matcher = { kind: 'all', of: [{ kind: 'any', of: [absent, present] }, { kind: 'not', of: absent }] };
    expect(evaluate(deep, sample).satisfied).toBe(true);
  });
});
