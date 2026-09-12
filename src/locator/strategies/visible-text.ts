/** Tier 3: text visible on the control itself -- its name or current value. */
import type { ObservedNode } from '../../surface/observation';
import type { LocatorStrategy } from '../descriptor';

type Strategy = Extract<LocatorStrategy, { strategy: 'visibleText' }>;

export function matchVisibleText(strategy: Strategy, nodes: readonly ObservedNode[]): ObservedNode[] {
  const text = strategy.text.trim().toLowerCase();
  return nodes.filter((n) => {
    if (strategy.role && n.role !== strategy.role) return false;
    if (strategy.framePath && n.framePath.join('/') !== strategy.framePath.join('/')) return false;
    return n.name.toLowerCase().includes(text) || (n.value ?? '').toLowerCase().includes(text);
  });
}
