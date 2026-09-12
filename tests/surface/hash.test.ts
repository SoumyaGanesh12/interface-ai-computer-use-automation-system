import { describe, expect, it } from 'vitest';
import { observationHash } from '../../src/surface/hash';
import type { ObservedNode } from '../../src/surface/observation';

function node(overrides: Partial<ObservedNode> = {}): ObservedNode {
  return {
    nodeId: 'n1',
    role: 'textbox',
    name: 'Member ID',
    enabled: true,
    visible: true,
    framePath: ['content'],
    ...overrides,
  };
}

describe('observationHash', () => {
  it('ignores bounds', () => {
    const a = observationHash([node({ bounds: { x: 10, y: 20, w: 100, h: 30 } })]);
    const b = observationHash([node({ bounds: { x: 11, y: 22, w: 100, h: 30 } })]);
    expect(a).toBe(b);
  });

  it('ignores nodeId', () => {
    const a = observationHash([node({ nodeId: 'aaa' })]);
    const b = observationHash([node({ nodeId: 'zzz' })]);
    expect(a).toBe(b);
  });

  it('changes when value changes', () => {
    const a = observationHash([node({ value: '' })]);
    const b = observationHash([node({ value: '41382' })]);
    expect(a).not.toBe(b);
  });

  it('changes when enabled or visible changes', () => {
    const base = observationHash([node()]);
    expect(observationHash([node({ enabled: false })])).not.toBe(base);
    expect(observationHash([node({ visible: false })])).not.toBe(base);
  });

  it('is order-independent', () => {
    const a = observationHash([node({ nodeId: '1', name: 'Row A' }), node({ nodeId: '2', name: 'Row B' })]);
    const b = observationHash([node({ nodeId: '2', name: 'Row B' }), node({ nodeId: '1', name: 'Row A' })]);
    expect(a).toBe(b);
  });

  it('distinguishes frames', () => {
    const a = observationHash([node({ framePath: ['nav'] })]);
    const b = observationHash([node({ framePath: ['content'] })]);
    expect(a).not.toBe(b);
  });
});
