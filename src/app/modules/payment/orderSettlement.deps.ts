/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── The database half of order settlement ──────────────────────────────────
//
// `orderSettlement.ts` holds the rules and knows nothing about Mongoose; this
// file is the adapter that gives those rules a real database. Keeping them apart
// is what lets the replay and tamper cases be tested against fakes rather than
// against the production cluster this repo is pointed at.
//
// Note what `settle` does NOT do: it does not mark the order paid itself. Paying
// an order also moves stock, sets the fulfillment status, and stamps confirmedAt,
// and those rules live in OrderService.completePayment. Re-implementing them here
// would give the codebase two definitions of "paid" that drift apart the first
// time one is edited, so this delegates instead.

import { Order } from '../order/order.model';
import { OrderService } from '../order/order.service';
import type { SettlementDeps, SettlementOrder } from './orderSettlement';

export const mongoSettlementDeps: SettlementDeps = {
  async findOrder({ transactionId, orderNumber, gatewayTransactionId }) {
    const or: Record<string, string>[] = [];
    // What we stored when the gateway session was opened...
    if (transactionId) or.push({ 'payment.transactionId': transactionId });
    // ...what settling REPLACED it with. Without this a replayed bKash callback
    // cannot find the order it already paid, so it never reaches the idempotency
    // gate. See the note on findOrder in orderSettlement.ts.
    if (gatewayTransactionId) or.push({ 'payment.transactionId': gatewayTransactionId });
    // ...and the invoice we handed the gateway. SSLCommerz is sent `tran_id =
    // orderNumber` and echoes that back, while its init response does not
    // reliably contain a tran_id to store — so the order number is the only
    // reference that survives a real round trip. bKash goes the other way and
    // gives us a paymentID up front. Matching all of these covers both gateways
    // both before and after settlement.
    if (orderNumber) or.push({ orderNumber });
    if (transactionId) or.push({ orderNumber: transactionId });
    if (or.length === 0) return null;

    const doc = await Order.findOne({ $or: or }).select(
      '_id orderNumber user total payment'
    );
    if (!doc) return null;

    return {
      _id: String(doc._id),
      orderNumber: doc.orderNumber,
      user: String((doc as any).user),
      total: doc.total,
      payment: {
        status: (doc.payment?.status as SettlementOrder['payment']['status']) || 'pending',
        method: doc.payment?.method,
        transactionId: doc.payment?.transactionId,
      },
    };
  },

  async settle({ orderId, userId, method, transactionId }) {
    await OrderService.completePayment(orderId, userId, { method, transactionId });
  },

  async markFailed({ orderId }) {
    // Guarded on the write itself rather than read-then-write: two callbacks can
    // land at once, and `payment.status: { $ne: 'paid' }` means a decline that
    // races a success can never overwrite a banked payment.
    await Order.updateOne(
      { _id: orderId, 'payment.status': { $ne: 'paid' } },
      { $set: { 'payment.status': 'failed' } }
    );
  },
};
