/**
 * Builds a LocatorDescriptor for a node the model picked by id, rather than asking the
 * model to invent tiered candidates itself -- perception and locator-building stay
 * deterministic code; the model's job is bounded selection from what it's shown. This is
 * also what a future recorder will use to compile a trace into an artifact, so it's
 * built once, shared, not duplicated between discovery and recording.
 *
 * Self-verifying: the generated descriptor is resolved against the same observation
 * before being returned, and rejected if it doesn't resolve back to the exact node it
 * was built for. A locator nobody can trust yet is a wasted click or a wrong one, not a
 * component to hand back optimistically.
 *
 * `labelProximity.direction` is descriptive metadata the resolver never actually
 * consults (see label-proximity.ts) -- defaulting it to 'right' here is a documentation
 * placeholder, not a functional claim about layout.
 */
import { resolve } from './resolve';
import type { LocatorCandidate, LocatorDescriptor, Tier } from './descriptor';
import type { Observation, ObservedNode } from '../surface/observation';

function buildCandidates(node: ObservedNode, allNodes: readonly ObservedNode[]): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];

  const name = node.name.trim();
  if (name) {
    const sameRoleAndName = allNodes.filter((n) => n.role === node.role && n.name.trim().toLowerCase() === name.toLowerCase());
    candidates.push({
      tier: 1,
      confidence: sameRoleAndName.length === 1 ? 0.9 : 0.4,
      note:
        sameRoleAndName.length === 1
          ? `Unique ${node.role} named "${name}".`
          : `${sameRoleAndName.length} nodes share role "${node.role}" and name "${name}" -- may not be unique.`,
      locator: { strategy: 'roleAndName', role: node.role, name },
    });
  }

  const textContext = node.textContext?.trim();
  if (textContext) {
    candidates.push({
      tier: 2,
      confidence: 0.7,
      note: `No name of its own -- identified by nearby text "${textContext.slice(0, 60)}".`,
      locator: { strategy: 'labelProximity', labelText: textContext.slice(0, 60), direction: 'right', role: node.role },
    });
  }

  const visible = name || node.value?.trim();
  if (visible) {
    candidates.push({
      tier: 3,
      confidence: 0.5,
      note: `Falls back to matching visible text "${visible}".`,
      locator: { strategy: 'visibleText', text: visible, role: node.role },
    });
  }

  return candidates;
}

export function generateDescriptor(node: ObservedNode, observation: Observation): LocatorDescriptor | undefined {
  const candidates = buildCandidates(node, observation.nodes);
  if (candidates.length === 0) return undefined;

  const recordedTier: Tier = candidates[0]!.tier;
  const descriptor: LocatorDescriptor = { candidates, recordedTier };

  const outcome = resolve(descriptor, observation);
  if (outcome.kind !== 'resolved' && outcome.kind !== 'not_enabled') return undefined;
  if (outcome.node.nodeId !== node.nodeId) return undefined;

  return descriptor;
}
