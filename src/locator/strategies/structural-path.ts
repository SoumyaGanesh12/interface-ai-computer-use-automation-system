/**
 * Tier 4: frame plus an ordered chain of landmark text (e.g. "table caption > row
 * label"), each segment checked as a substring of textContext. A simplification until
 * the fixture's actual markup shows what richer structural addressing needs to look like.
 */
import type { ObservedNode } from '../../surface/observation';
import type { LocatorStrategy } from '../descriptor';

type Strategy = Extract<LocatorStrategy, { strategy: 'structuralPath' }>;

export function matchStructuralPath(strategy: Strategy, nodes: readonly ObservedNode[]): ObservedNode[] {
  const segments = strategy.path
    .split('>')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return nodes.filter((n) => {
    if (n.framePath.join('/') !== strategy.framePath.join('/')) return false;
    const haystack = (n.textContext ?? '').toLowerCase();
    return segments.every((seg) => haystack.includes(seg));
  });
}
