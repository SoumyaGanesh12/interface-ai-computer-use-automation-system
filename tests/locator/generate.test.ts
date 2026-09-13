import { describe, expect, it } from 'vitest';
import { generateDescriptor } from '../../src/locator/generate';
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

describe('generateDescriptor', () => {
  it('builds a tier-1 roleAndName descriptor for a uniquely named node', () => {
    const target = node({ nodeId: 'search-btn', name: 'Search' });
    const descriptor = generateDescriptor(target, obs([target]));

    expect(descriptor).toBeDefined();
    expect(descriptor?.recordedTier).toBe(1);
    expect(descriptor?.candidates[0]).toMatchObject({ tier: 1, locator: { strategy: 'roleAndName', role: 'button', name: 'Search' } });
  });

  it('falls back to labelProximity when the node has no name of its own', () => {
    const target = node({ nodeId: 'pw-field', role: 'textbox', name: '', textContext: 'Password' });
    const descriptor = generateDescriptor(target, obs([target]));

    expect(descriptor).toBeDefined();
    expect(descriptor?.recordedTier).toBe(2);
    expect(descriptor?.candidates[0]).toMatchObject({ tier: 2, locator: { strategy: 'labelProximity', labelText: 'Password' } });
  });

  it('returns undefined when the node has neither a name nor textContext nor a value', () => {
    const target = node({ nodeId: 'mystery', role: 'unknown', name: '' });
    expect(generateDescriptor(target, obs([target]))).toBeUndefined();
  });

  it('rejects a node whose name is shared by another node and has nothing else to disambiguate it', () => {
    // Same role, same name, no textContext or value on either -- genuinely ambiguous:
    // the tier-1 candidate itself notes the collision, and resolve() confirms it can't
    // pick one, so generateDescriptor must not hand back a descriptor for either node.
    const a = node({ nodeId: 'a', name: 'Save' });
    const b = node({ nodeId: 'b', name: 'Save' });
    expect(generateDescriptor(a, obs([a, b]))).toBeUndefined();
  });

  it('rejects a descriptor that would resolve to a different node than the one it was built for', () => {
    // The label-proximity candidate collides with another textbox sharing the same textContext:
    // resolve() reports ambiguous, so generateDescriptor must not hand back a descriptor that
    // silently points somewhere else.
    const target = node({ nodeId: 'field-1', role: 'textbox', name: '', textContext: 'Amount' });
    const decoy = node({ nodeId: 'field-2', role: 'textbox', name: '', textContext: 'Amount' });
    expect(generateDescriptor(target, obs([target, decoy]))).toBeUndefined();
  });
});
