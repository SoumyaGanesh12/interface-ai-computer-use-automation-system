/**
 * Tier 5, last resort: find a uniquely-named anchor, then the node whose bounds contain
 * the point offset (dx, dy) from the anchor's origin. An ambiguous or missing anchor, or
 * a target with no bounds, yields no match rather than a guess.
 */
import type { ObservedNode } from '../../surface/observation';
import type { LocatorStrategy } from '../descriptor';

type Strategy = Extract<LocatorStrategy, { strategy: 'anchoredCoordinates' }>;

export function matchAnchoredCoordinates(strategy: Strategy, nodes: readonly ObservedNode[]): ObservedNode[] {
  const anchorName = strategy.anchorName.trim().toLowerCase();
  const anchors = nodes.filter((n) => n.visible && n.bounds && n.name.trim().toLowerCase() === anchorName);
  if (anchors.length !== 1) return [];

  const anchor = anchors[0]!;
  const px = anchor.bounds!.x + strategy.dx;
  const py = anchor.bounds!.y + strategy.dy;

  return nodes.filter((n) => {
    if (!n.bounds) return false;
    return px >= n.bounds.x && px <= n.bounds.x + n.bounds.w && py >= n.bounds.y && py <= n.bounds.y + n.bounds.h;
  });
}
