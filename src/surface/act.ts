/**
 * Dispatches one Action against a live page. Locator resolution happens here, against a
 * freshly taken observation, immediately before dispatch -- never reused from an earlier
 * observation, and no nodeId crosses out of this module.
 *
 * Click/type/typeCredential act on a computed bounding-box center point via real
 * mouse/keyboard events -- this works even with no DOM access at all, which is the same
 * assumption a desktop adapter would have to make. `select` is the one exception: a
 * native dropdown genuinely needs a live element handle (see element-handle.ts).
 */
import type { CDPSession, Page } from 'playwright';
import { resolve } from '../locator/resolve';
import { resolveElementHandle } from './element-handle';
import { perceive } from './perceive';
import { checkPolicy, type Allowlist } from '../policy/allowlist';
import type { CredentialProvider } from '../policy/credentials';
import type { Action, ActionResult } from './action';

export async function performAction(
  page: Page,
  cdp: CDPSession,
  runId: string,
  seq: number,
  action: Action,
  credentials: CredentialProvider,
  policy: Allowlist,
): Promise<ActionResult> {
  const policyResult = checkPolicy(action, policy);
  if (!policyResult.allowed) {
    return { ok: false, reason: 'policy_denied', detail: policyResult.reason ?? 'denied' };
  }

  if (action.kind === 'navigate') {
    await page.goto(action.url);
    return { ok: true };
  }

  const { observation, index } = await perceive(page, cdp, runId, seq);
  const outcome = resolve(action.target, observation);

  if (outcome.kind === 'unresolved') return { ok: false, reason: 'unresolved', detail: 'no candidate matched any node' };
  if (outcome.kind === 'ambiguous') {
    return { ok: false, reason: 'ambiguous', detail: `${outcome.count} nodes matched at tier ${outcome.tier}` };
  }
  if (outcome.kind === 'not_visible') return { ok: false, reason: 'not_visible', detail: `matched at tier ${outcome.tier} but hidden` };
  if (outcome.kind === 'not_enabled' && action.kind !== 'read') {
    return { ok: false, reason: 'not_enabled', detail: `matched at tier ${outcome.tier} but disabled` };
  }
  // outcome is now 'resolved', or ('not_enabled' with a read -- reading a disabled control's value is legitimate).

  const { node, tier } = outcome;
  const ref = index.get(node.nodeId);
  const center = node.bounds ? { x: node.bounds.x + node.bounds.w / 2, y: node.bounds.y + node.bounds.h / 2 } : undefined;

  switch (action.kind) {
    case 'click': {
      if (!center) return { ok: false, reason: 'unresolved', detail: 'matched node has no bounds to click' };
      // A zero-gap synthetic press+release is occasionally too fast for a real
      // handler to register as a genuine click (observed: the server never received
      // the resulting form POST at all). A small delay is Playwright's own documented
      // mitigation for this.
      await page.mouse.click(center.x, center.y, { delay: 50 });
      // A click can trigger a navigation, but the browser doesn't necessarily start it
      // synchronously with the click event -- observed: the next perceive()'s
      // waitForLoadState('load') sometimes resolved against the page BEFORE navigation,
      // not after, because navigation genuinely hadn't started yet. This gives it a
      // moment to actually begin.
      await page.waitForTimeout(150);
      return { ok: true, resolvedTier: tier };
    }

    case 'type':
    case 'typeCredential': {
      if (!center) return { ok: false, reason: 'unresolved', detail: 'matched node has no bounds to focus' };
      await page.mouse.click(center.x, center.y, { delay: 50 });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      const text = action.kind === 'typeCredential' ? credentials.resolve(action.credentialRef) : action.text;
      await page.keyboard.type(text);
      return { ok: true, resolvedTier: tier };
    }

    case 'select': {
      if (!ref) return { ok: false, reason: 'unresolved', detail: 'no DOM reference for this node' };
      const handle = await resolveElementHandle(page, cdp, ref.frameName, ref.backendNodeId);
      if (!handle) return { ok: false, reason: 'unresolved', detail: 'could not bridge to a live element handle' };
      await handle.selectOption(action.option);
      return { ok: true, resolvedTier: tier };
    }

    case 'read': {
      const value = action.source === 'value' ? (node.value ?? '') : node.name;
      return { ok: true, value, resolvedTier: tier };
    }
  }
}
