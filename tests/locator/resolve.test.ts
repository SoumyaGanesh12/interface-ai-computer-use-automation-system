import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/locator/resolve';
import type { LocatorDescriptor } from '../../src/locator/descriptor';
import type { Observation, ObservedNode } from '../../src/surface/observation';

function node(overrides: Partial<ObservedNode> = {}): ObservedNode {
  return {
    nodeId: 'n',
    role: 'button',
    name: '',
    enabled: true,
    visible: true,
    framePath: [],
    ...overrides,
  };
}

function obs(nodes: ObservedNode[]): Observation {
  return { runId: 'r1', seq: 0, url: 'http://x', title: '', nodes, hash: 'h', capturedAt: '2026-01-01T00:00:00Z' };
}

function descriptor(...candidates: LocatorDescriptor['candidates']): LocatorDescriptor {
  return { candidates, recordedTier: candidates[0]!.tier };
}

describe('resolve', () => {
  it('resolves a unique tier-1 match', () => {
    const outcome = resolve(
      descriptor({ tier: 1, confidence: 0.95, note: 'stable name', locator: { strategy: 'roleAndName', role: 'button', name: 'Search' } }),
      obs([node({ name: 'Search' })]),
    );
    expect(outcome).toMatchObject({ kind: 'resolved', tier: 1 });
  });

  it('falls through to a weaker tier when the stronger one finds nothing', () => {
    const outcome = resolve(
      descriptor(
        { tier: 1, confidence: 0.9, note: 'no such name', locator: { strategy: 'roleAndName', role: 'button', name: 'Nope' } },
        { tier: 3, confidence: 0.5, note: 'visible text fallback', locator: { strategy: 'visibleText', text: 'Search' } },
      ),
      obs([node({ name: 'Search' })]),
    );
    expect(outcome).toMatchObject({ kind: 'resolved', tier: 3 });
  });

  it('reports ambiguous when a candidate matches more than one node and nothing disambiguates', () => {
    const outcome = resolve(
      descriptor({ tier: 1, confidence: 0.8, note: 'two buttons share a name', locator: { strategy: 'roleAndName', role: 'button', name: 'Save' } }),
      obs([node({ nodeId: 'a', name: 'Save' }), node({ nodeId: 'b', name: 'Save' })]),
    );
    expect(outcome).toMatchObject({ kind: 'ambiguous', tier: 1, count: 2 });
  });

  it('reports unresolved when no candidate matches anything', () => {
    const outcome = resolve(
      descriptor({ tier: 1, confidence: 0.8, note: 'nothing here', locator: { strategy: 'roleAndName', role: 'button', name: 'Ghost' } }),
      obs([node({ name: 'Search' })]),
    );
    expect(outcome).toMatchObject({ kind: 'unresolved' });
  });

  it('stops at a unique match that is hidden, rather than falling through', () => {
    const outcome = resolve(
      descriptor(
        { tier: 1, confidence: 0.9, note: 'the real target, currently hidden', locator: { strategy: 'roleAndName', role: 'button', name: 'Confirm' } },
        { tier: 3, confidence: 0.4, note: 'would coincidentally match a different node', locator: { strategy: 'visibleText', text: 'Confirm' } },
      ),
      obs([node({ nodeId: 'hidden-target', name: 'Confirm', visible: false }), node({ nodeId: 'decoy', name: 'Confirm anyway', role: 'link' })]),
    );
    expect(outcome).toMatchObject({ kind: 'not_visible', tier: 1 });
  });

  it('stops at a unique match that is disabled', () => {
    const outcome = resolve(
      descriptor({ tier: 1, confidence: 0.9, note: 'disabled until form is valid', locator: { strategy: 'roleAndName', role: 'button', name: 'Submit' } }),
      obs([node({ name: 'Submit', enabled: false })]),
    );
    expect(outcome).toMatchObject({ kind: 'not_enabled', tier: 1 });
  });

  it('matches structuralPath by frame plus ordered landmark segments', () => {
    const outcome = resolve(
      descriptor({
        tier: 4,
        confidence: 0.6,
        note: 'row anchored to table caption',
        locator: { strategy: 'structuralPath', framePath: ['content'], path: 'Accounts > 41382' },
      }),
      obs([node({ role: 'cell', framePath: ['content'], textContext: 'Accounts table, row for member 41382' })]),
    );
    expect(outcome.kind).toBe('resolved');
  });

  it('resolves anchoredCoordinates via a unique anchor plus offset', () => {
    const outcome = resolve(
      descriptor({
        tier: 5,
        confidence: 0.3,
        note: 'no name on this control, positioned right of the label',
        locator: { strategy: 'anchoredCoordinates', anchorName: 'Member ID', dx: 120, dy: 0 },
      }),
      obs([
        node({ nodeId: 'label', role: 'text', name: 'Member ID', bounds: { x: 10, y: 10, w: 80, h: 20 } }),
        node({ nodeId: 'field', role: 'textbox', name: '', bounds: { x: 130, y: 10, w: 100, h: 20 } }),
      ]),
    );
    expect(outcome).toMatchObject({ kind: 'resolved', tier: 5 });
    if (outcome.kind === 'resolved') expect(outcome.node.nodeId).toBe('field');
  });
});
