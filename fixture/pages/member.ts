/**
 * Member detail: an accounts table where the balance cell carries no id/label of its
 * own -- only its row's text -- and a note on any existing card order, so a later
 * idempotency check has something durable to read.
 */
import { page } from '../layout';
import type { Member } from '../data';
import type { CardOrder } from '../orders';
import type { Tenant } from '../session';

export function memberPage(member: Member, tenant: Tenant, existingOrder: CardOrder | undefined): string {
  const idLabel = tenant === 'b' ? 'Account Number' : 'Member ID';
  // Same rule as the confirm-order screen itself (../cardOrder.ts): once a member has an
  // order, no page in this flow offers a way to start another one. A notice-only page one
  // click further in is not "the same fix" if the entry point one click earlier still
  // invites the click that leads there.
  const orderSection = existingOrder
    ? `<div class="notice">A replacement card was already ordered for this member. Reference ${existingOrder.reference}, placed ${existingOrder.orderedAt}.</div>`
    : `<p><span class="actionCell" onclick="location.href='/card/order?id=${member.id}'">Order Replacement Card</span></p>`;
  return page(
    'Member Detail',
    `
<p>${idLabel}: ${member.id} &mdash; ${member.name}</p>
<table class="acct">
  <tr><td>Savings</td><td>$${member.savings.toFixed(2)}</td></tr>
  <tr><td>Checking</td><td>$${member.checking.toFixed(2)}</td></tr>
</table>
${orderSection}
`,
    tenant,
  );
}
