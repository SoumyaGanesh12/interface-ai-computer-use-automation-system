/**
 * Builds an Observation from a live page: one CDP session, frameId-scoped
 * `Accessibility.getFullAXTree` per frame (a same-origin frame has no CDP session of its
 * own -- confirmed against the fixture's frameset before writing this), plus the
 * dom-lite tree for textContext and a per-node `DOM.getBoxModel` for bounds/visibility.
 *
 * Nothing here is fixture-specific; it only knows Observation, Role, and CDP's wire
 * shapes.
 */
import type { CDPSession, Page } from 'playwright';
import { mapChromeRole } from './roles';
import { buildDomLiteTree, computeTextContext, isDisabled } from './dom-lite';
import { observationHash } from './hash';
import type { Observation, ObservedNode } from './observation';

interface CdpFrame {
  id: string;
  url: string;
  name?: string;
}

interface FrameTreeResult {
  frameTree: { frame: { id: string; url: string; name?: string }; childFrames?: FrameTreeResult['frameTree'][] };
}

function flattenFrames(node: FrameTreeResult['frameTree']): CdpFrame[] {
  return [{ id: node.frame.id, url: node.frame.url, name: node.frame.name }, ...(node.childFrames ?? []).flatMap(flattenFrames)];
}

/**
 * What `act()` needs to actually dispatch on a node the resolver picked, kept out of the
 * public Observation type -- nodeId is opaque everywhere except here, inside the one
 * module allowed to know what it really points to.
 */
export interface NodeRef {
  backendNodeId: number;
  frameName?: string;
}

export interface PerceiveResult {
  observation: Observation;
  index: Map<string, NodeRef>;
}

export async function perceive(page: Page, cdp: CDPSession, runId: string, seq: number): Promise<PerceiveResult> {
  // A click can trigger a navigation whose result we're about to read. `load` on the
  // top document only fires once every frameset child frame has finished loading too
  // (standard frame-load semantics), so this is enough even for our two-frame layout.
  await page.waitForLoadState('load').catch(() => {});

  const { frameTree } = (await cdp.send('Page.getFrameTree')) as FrameTreeResult;
  const cdpFrames = flattenFrames(frameTree);
  const domTree = await buildDomLiteTree(cdp);

  const nodes: ObservedNode[] = [];
  const index = new Map<string, NodeRef>();

  for (const frame of cdpFrames) {
    const framePath = frame.name ? [frame.name] : [];
    const tree = await cdp.send('Accessibility.getFullAXTree', { frameId: frame.id });

    // Chrome routinely represents a control's own accessible name as a StaticText
    // descendant carrying that exact same text -- e.g. a table cell "Search" containing
    // an empty-named `generic` wrapper containing a StaticText "Search". Both the cell
    // and the StaticText would otherwise land in the flattened list with an identical
    // name, making every visibleText/label lookup spuriously ambiguous. Raw node data,
    // so the chain up to a same-named ancestor can be found and the duplicate dropped.
    const rawById = new Map<string, { name: string; parentId?: string }>();
    for (const ax of tree.nodes) rawById.set(ax.nodeId, { name: ax.name?.value ?? '', parentId: ax.parentId });

    function hasSameNamedAncestor(nodeId: string, name: string): boolean {
      let parentId = rawById.get(nodeId)?.parentId;
      for (let depth = 0; parentId && depth < 8; depth++) {
        const parent = rawById.get(parentId);
        if (!parent) return false;
        if (parent.name === name) return true;
        parentId = parent.parentId;
      }
      return false;
    }

    for (const ax of tree.nodes) {
      const role = mapChromeRole(ax.role?.value ?? '');
      if (role === 'skip') continue;
      if (role === 'text' && ax.name?.value && hasSameNamedAncestor(ax.nodeId, ax.name.value)) continue;

      const backendId = ax.backendDOMNodeId;
      let visible = true;
      let bounds: ObservedNode['bounds'];
      if (backendId !== undefined) {
        try {
          const box = await cdp.send('DOM.getBoxModel', { backendNodeId: backendId });
          const [x1, y1, , , x2, y2] = box.model.content;
          bounds = { x: x1!, y: y1!, w: x2! - x1!, h: y2! - y1! };
        } catch {
          visible = false;
        }
      }
      const enabled = backendId !== undefined ? !isDisabled(backendId, domTree) : true;
      const textContext = backendId !== undefined ? computeTextContext(backendId, domTree) : undefined;

      const nodeId = `${frame.id}:${ax.nodeId}`;
      nodes.push({
        nodeId,
        role,
        name: ax.name?.value ?? '',
        value: ax.value?.value !== undefined ? String(ax.value.value) : undefined,
        enabled,
        visible,
        framePath,
        bounds,
        textContext,
        parentId: ax.parentId ? `${frame.id}:${ax.parentId}` : undefined,
      });
      if (backendId !== undefined) index.set(nodeId, { backendNodeId: backendId, frameName: frame.name });
    }
  }

  const observation: Observation = {
    runId,
    seq,
    url: page.url(),
    title: await page.title(),
    nodes,
    hash: observationHash(nodes),
    capturedAt: new Date().toISOString(),
  };
  return { observation, index };
}
