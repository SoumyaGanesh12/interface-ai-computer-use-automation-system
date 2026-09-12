/**
 * In-memory replacement-card orders. Durable within the process, which is what lets a
 * later idempotency probe find "was this already submitted" instead of guessing.
 */
export interface CardOrder {
  memberId: string;
  reference: string;
  orderedAt: string;
}

const orders = new Map<string, CardOrder>();

export function findOrder(memberId: string): CardOrder | undefined {
  return orders.get(memberId);
}

export function placeOrder(memberId: string): CardOrder {
  const order: CardOrder = { memberId, reference: `REF-${Math.floor(10000 + Math.random() * 90000)}`, orderedAt: new Date().toISOString() };
  orders.set(memberId, order);
  return order;
}
