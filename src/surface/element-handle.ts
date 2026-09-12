/**
 * Bridges a backendNodeId to a live Playwright handle -- needed only for `select`
 * (choosing an option on a native dropdown genuinely requires a DOM handle; a native
 * popup isn't something coordinates can drive portably). Click/type never need this:
 * a computed bounding-box center point is enough for both.
 *
 * The bridge: push the backend node to the frontend, tag it with a throwaway attribute,
 * find it via Playwright's own locator, then remove the tag. Frame is matched by name --
 * a simplification that holds because this fixture's frames are uniquely named.
 */
import type { CDPSession, ElementHandle, Page } from 'playwright';

export async function resolveElementHandle(
  page: Page,
  cdp: CDPSession,
  frameName: string | undefined,
  backendNodeId: number,
): Promise<ElementHandle | null> {
  const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] });
  const nodeId = nodeIds[0];
  if (!nodeId) return null;

  const marker = `data-cua-${Math.random().toString(36).slice(2, 10)}`;
  await cdp.send('DOM.setAttributeValue', { nodeId, name: marker, value: '1' });

  const frame = frameName ? page.frames().find((f) => f.name() === frameName) : page.mainFrame();
  const handle = frame ? await frame.locator(`[${marker}]`).elementHandle({ timeout: 2000 }).catch(() => null) : null;

  cdp.send('DOM.removeAttribute', { nodeId, name: marker }).catch(() => {});
  return handle;
}
