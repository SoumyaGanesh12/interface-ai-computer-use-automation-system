/**
 * Tries each candidate in order; the first that identifies exactly one node wins. If
 * that node is disabled or hidden, resolution stops right there with that specific
 * reason -- it does not fall through to a weaker tier, which could coincidentally match
 * a different element and act on the wrong thing.
 */
import type { Observation, ObservedNode } from '../surface/observation';
import type { LocatorDescriptor, LocatorStrategy, Tier } from './descriptor';
import { matchRoleAndName } from './strategies/role-and-name';
import { matchLabelProximity } from './strategies/label-proximity';
import { matchVisibleText } from './strategies/visible-text';
import { matchStructuralPath } from './strategies/structural-path';
import { matchAnchoredCoordinates } from './strategies/anchored-coordinates';

export type ResolveOutcome =
  | { kind: 'resolved'; node: ObservedNode; tier: Tier }
  | { kind: 'not_visible'; node: ObservedNode; tier: Tier }
  | { kind: 'not_enabled'; node: ObservedNode; tier: Tier }
  | { kind: 'ambiguous'; tier: Tier; count: number }
  | { kind: 'unresolved' };

function identityMatches(strategy: LocatorStrategy, nodes: readonly ObservedNode[]): ObservedNode[] {
  switch (strategy.strategy) {
    case 'roleAndName':
      return matchRoleAndName(strategy, nodes);
    case 'labelProximity':
      return matchLabelProximity(strategy, nodes);
    case 'visibleText':
      return matchVisibleText(strategy, nodes);
    case 'structuralPath':
      return matchStructuralPath(strategy, nodes);
    case 'anchoredCoordinates':
      return matchAnchoredCoordinates(strategy, nodes);
  }
}

export function resolve(descriptor: LocatorDescriptor, obs: Observation): ResolveOutcome {
  let ambiguity: { tier: Tier; count: number } | undefined;

  for (const candidate of descriptor.candidates) {
    const matches = identityMatches(candidate.locator, obs.nodes);
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      ambiguity ??= { tier: candidate.tier, count: matches.length };
      continue;
    }

    const node = matches[0]!;
    if (!node.visible) return { kind: 'not_visible', node, tier: candidate.tier };
    if (!node.enabled) return { kind: 'not_enabled', node, tier: candidate.tier };
    return { kind: 'resolved', node, tier: candidate.tier };
  }

  return ambiguity ? { kind: 'ambiguous', ...ambiguity } : { kind: 'unresolved' };
}
