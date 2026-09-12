/** Tier 1: role + accessible name. Most robust -- survives layout and markup changes. */
import type { ObservedNode } from '../../surface/observation';
import type { LocatorStrategy } from '../descriptor';

type Strategy = Extract<LocatorStrategy, { strategy: 'roleAndName' }>;

export function matchRoleAndName(strategy: Strategy, nodes: readonly ObservedNode[]): ObservedNode[] {
  return nodes.filter((n) => {
    if (n.role !== strategy.role) return false;
    return strategy.exact
      ? n.name === strategy.name
      : n.name.trim().toLowerCase() === strategy.name.trim().toLowerCase();
  });
}
