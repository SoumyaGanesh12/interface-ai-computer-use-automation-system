/**
 * The one irreversible flow. Tenant b adds a second confirmation step -- a stand-in for
 * "two institutions on the same vendor product, one configured stricter than the other."
 * The fixture itself is the source of truth for "does this member already have an
 * order" (see POST /card/order in ../app.ts) -- this page reflects that by omitting the
 * submit form entirely once one exists, rather than leaving it clickable and relying on
 * the calling automation's own idempotency probe to be the only thing standing between a
 * person and a second submission.
 */
import { page } from '../layout';
import type { Member } from '../data';
import type { CardOrder } from '../orders';
import type { Tenant } from '../session';

export function verifyIdentityPage(member: Member, tenant: Tenant): string {
  return page(
    'Verify Identity',
    `
<p>Before ordering a replacement card, confirm the member's identity has been verified.</p>
<form method="get" action="/card/order">
  <input type="hidden" name="id" value="${member.id}">
  <input type="hidden" name="verified" value="1">
  <table class="fld">
    <tr><td><input type="checkbox" id="chk" checked></td><td><label for="chk">Identity verified</label></td></tr>
    <tr><td colspan="2"><button type="submit">Continue</button></td></tr>
  </table>
</form>
`,
    tenant,
  );
}

export function confirmOrderPage(member: Member, tenant: Tenant, existingOrder: CardOrder | undefined): string {
  if (existingOrder) {
    return page(
      'Order Replacement Card',
      `<div class="notice">A replacement card was already ordered for this member. Reference ${existingOrder.reference}, placed ${existingOrder.orderedAt}.</div>`,
      tenant,
    );
  }
  return page(
    'Order Replacement Card',
    `
<p>Order a replacement card for ${member.name} (${member.id})? This action cannot be undone.</p>
<form method="post" action="/card/order">
  <input type="hidden" name="id" value="${member.id}">
  <button type="submit">Confirm Order</button>
</form>
`,
    tenant,
  );
}

export function orderConfirmedPage(order: CardOrder, tenant: Tenant): string {
  return page(
    'Order Confirmed',
    `<p>Replacement card ordered. Confirmation reference: <strong>${order.reference}</strong></p>`,
    tenant,
  );
}
