/**
 * A lightweight DOM tree built from ONE `DOM.getDocument({ depth: -1, pierce: true })`
 * call, keyed by backendNodeId -- the same id an accessibility node carries. This is
 * what makes textContext possible: a layout table of `<td onclick>` has no accessible
 * semantics for the AX tree to expose, so "the label cell to the left" has to come from
 * walking real DOM structure instead.
 *
 * `pierce: true` composes iframe contents into the same call, so this single fetch
 * covers every frame in the frameset, not just the top document.
 *
 * Simplification, refetched whole on every observe(): fine for this fixture's size; a
 * much larger real page would want incremental updates instead of a full refetch.
 */
import type { CDPSession } from 'playwright';

interface CdpDomNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue: string;
  attributes?: string[];
  children?: CdpDomNode[];
  contentDocument?: CdpDomNode;
}

export interface DomLiteNode {
  backendNodeId: number;
  nodeType: number;
  tagName: string; // uppercase tag, or '#text' for a text node
  attributes: Record<string, string>;
  text: string; // own text, only meaningful for a text node
  parentBackendId?: number;
  childBackendIds: number[];
}

function flatAttrsToRecord(attrs: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs) return out;
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    const key = attrs[i]!;
    out[key] = attrs[i + 1]!;
  }
  return out;
}

export async function buildDomLiteTree(cdp: CDPSession): Promise<Map<number, DomLiteNode>> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const tree = new Map<number, DomLiteNode>();

  function visit(node: CdpDomNode, parentBackendId: number | undefined) {
    const lite: DomLiteNode = {
      backendNodeId: node.backendNodeId,
      nodeType: node.nodeType,
      tagName: node.nodeName.toUpperCase(),
      attributes: flatAttrsToRecord(node.attributes),
      text: node.nodeType === 3 ? node.nodeValue : '',
      parentBackendId,
      childBackendIds: [],
    };
    tree.set(node.backendNodeId, lite);
    for (const child of node.children ?? []) {
      lite.childBackendIds.push(child.backendNodeId);
      visit(child, node.backendNodeId);
    }
    if (node.contentDocument) visit(node.contentDocument, node.backendNodeId);
  }

  visit(root as CdpDomNode, undefined);
  return tree;
}

function collectText(backendId: number, tree: Map<number, DomLiteNode>): string {
  const node = tree.get(backendId);
  if (!node) return '';
  if (node.nodeType === 3) return node.text.trim();
  return node.childBackendIds
    .map((id) => collectText(id, tree))
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Nearest-row-label heuristic: walk up to the enclosing <tr>, then concatenate the text
 * of every preceding sibling cell in that row. Falls back to preceding-sibling text at
 * whatever level the node sits at, for markup with no enclosing row at all.
 */
export function computeTextContext(backendId: number, tree: Map<number, DomLiteNode>): string | undefined {
  let cell = tree.get(backendId);
  if (!cell) return undefined;

  // Walk up to find the ancestor that is a direct child of a <tr>.
  let row: DomLiteNode | undefined;
  let cursor = cell;
  while (cursor.parentBackendId !== undefined) {
    const parent = tree.get(cursor.parentBackendId);
    if (!parent) break;
    if (parent.tagName === 'TR') {
      row = parent;
      cell = cursor;
      break;
    }
    cursor = parent;
  }

  if (row) {
    const myIndex = row.childBackendIds.indexOf(cell.backendNodeId);
    const preceding = row.childBackendIds.slice(0, myIndex < 0 ? 0 : myIndex);
    const text = preceding
      .map((id) => collectText(id, tree))
      .filter(Boolean)
      .join(' | ');
    if (text) return text;
  }

  // Fallback: preceding siblings at the node's own level.
  const parent = cell.parentBackendId !== undefined ? tree.get(cell.parentBackendId) : undefined;
  if (parent) {
    const myIndex = parent.childBackendIds.indexOf(cell.backendNodeId);
    const preceding = parent.childBackendIds.slice(0, myIndex < 0 ? 0 : myIndex);
    const text = preceding
      .map((id) => collectText(id, tree))
      .filter(Boolean)
      .join(' | ');
    if (text) return text;
  }

  return undefined;
}

export function isDisabled(backendId: number, tree: Map<number, DomLiteNode>): boolean {
  const node = tree.get(backendId);
  if (!node) return false;
  return 'disabled' in node.attributes || node.attributes['aria-disabled'] === 'true';
}
