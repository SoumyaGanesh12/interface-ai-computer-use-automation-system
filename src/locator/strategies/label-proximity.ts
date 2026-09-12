/**
 * Tier 2: nearby label text (row label, column header, adjacent cell). `direction`
 * describes how the surface adapter derived textContext; the resolver only sees the
 * resulting string, so it isn't consulted here.
 */
import type { ObservedNode } from '../../surface/observation';
import type { LocatorStrategy } from '../descriptor';

type Strategy = Extract<LocatorStrategy, { strategy: 'labelProximity' }>;

export function matchLabelProximity(strategy: Strategy, nodes: readonly ObservedNode[]): ObservedNode[] {
  const label = strategy.labelText.trim().toLowerCase();
  return nodes.filter((n) => {
    if (strategy.role && n.role !== strategy.role) return false;
    return !!n.textContext && n.textContext.toLowerCase().includes(label);
  });
}
