// ─── Settling a book order from a gateway callback ──────────────────────────
//
// A gateway tells us a payment happened three separate times: the browser
// redirect, the server-to-server IPN, and any retry of either. All three land
// here, and only the first one may move money-adjacent state — the second must
// be a no-op that still answers 200, or SSLCommerz keeps retrying an IPN we have
// already honoured.
//
// The logic is kept free of Mongoose and of Express on purpose. Everything it
// touches arrives through `SettlementDeps`, so the replay and tamper cases can be
// unit-tested against fakes without a database — which matters here because the
// only database this repo is pointed at is production.

export type GatewayName = 'bkash' | 'sslcommerz';

/** The slice of an Order this module needs. */
export interface SettlementOrder {
  _id: string;
  orderNumber: string;
  user: string;
  total: number;
  payment: {
    status: 'pending' | 'paid' | 'failed';
    method?: string;
    transactionId?: string;
  };
}

export interface SettlementDeps {
  /**
   * Find the order a gateway reference belongs to. Returns null when the
   * reference is not a book order at all — course enrollments share these
   * endpoints and must keep working untouched.
   *
   * Three references are offered because which one identifies the order CHANGES
   * once it is settled. An order opens holding the session reference (bKash's
   * paymentID), but paying it overwrites `payment.transactionId` with the
   * gateway's own trxID — so a replayed callback looked up by paymentID alone
   * finds nothing, reports 'not-an-order', and sails straight past the
   * idempotency gate it was supposed to hit. Matching any of the three keeps a
   * replay recognisable before and after settlement.
   */
  findOrder(ref: {
    /** The reference we handed the gateway (bKash paymentID / SSL tran_id). */
    transactionId?: string;
    orderNumber?: string;
    /** The gateway's own id for the captured money — what settling stores. */
    gatewayTransactionId?: string;
  }): Promise<SettlementOrder | null>;
  /** Mark paid + run the order module's own side effects (stock, status). */
  settle(input: {
    orderId: string;
    userId: string;
    method: GatewayName;
    transactionId: string;
  }): Promise<void>;
  /** Record a declined/aborted attempt. Must not touch stock. */
  markFailed?(input: { orderId: string; reason: string }): Promise<void>;
}

export interface SettlementInput {
  gateway: GatewayName;
  /** What we handed the gateway: paymentID (bKash) or tran_id (SSLCommerz). */
  reference?: string;
  /** Our order number, when the gateway echoes it back as the invoice. */
  orderNumber?: string;
  /** The gateway's own transaction id for the captured money. */
  transactionId?: string;
  /** Amount the gateway says was paid. Compared against the order total. */
  paidAmount?: number | string;
  /** Whether the gateway reported the payment as successful. */
  succeeded: boolean;
  /**
   * The buyer backed out rather than the gateway declining. Kept apart from a
   * plain failure because a cancelled attempt should leave the order pending and
   * retryable — stamping it `failed` would be a lie about what happened, and the
   * buyer very often comes straight back to pay with COD instead.
   */
  cancelled?: boolean;
  /** Gateway-provided reason when !succeeded. */
  reason?: string;
}

export type SettlementResult =
  /** First valid callback — the order was just marked paid. */
  | { outcome: 'settled'; orderId: string; orderNumber: string }
  /** Replay: the order was already paid. Nothing was touched. */
  | { outcome: 'already-paid'; orderId: string; orderNumber: string }
  /** The reference belongs to no order — caller should try the enrollment path. */
  | { outcome: 'not-an-order' }
  /** Payload failed verification. Deliberately NOT settled. */
  | { outcome: 'rejected'; orderId?: string; orderNumber?: string; reason: string }
  /** Gateway reported a genuine failure/cancellation. */
  | { outcome: 'failed'; orderId: string; orderNumber: string; reason: string };

/**
 * Money comparison with a 1-poisha tolerance.
 *
 * Gateways return amounts as strings and SSLCommerz pads them ("700.00"), so a
 * strict !== would reject every legitimate payment. A whole-taka difference is
 * still a mismatch and still gets rejected.
 */
const amountMatches = (expected: number, reported: number | string | undefined): boolean => {
  if (reported === undefined || reported === null || reported === '') return true; // not supplied → cannot check
  const got = Number(reported);
  if (!Number.isFinite(got)) return false;
  return Math.abs(got - expected) < 0.01;
};

export const settleGatewayPayment = async (
  deps: SettlementDeps,
  input: SettlementInput
): Promise<SettlementResult> => {
  const { gateway, reference, orderNumber, transactionId, paidAmount, succeeded, cancelled, reason } =
    input;

  if (!reference && !orderNumber) {
    return { outcome: 'rejected', reason: 'no payment reference in callback' };
  }

  const order = await deps.findOrder({
    transactionId: reference,
    orderNumber,
    gatewayTransactionId: transactionId,
  });

  // Not one of ours (or belongs to the course/enrollment flow) — let the caller
  // fall through rather than inventing a failure.
  if (!order) return { outcome: 'not-an-order' };

  // ── Idempotency gate ──────────────────────────────────────────────────────
  // Checked BEFORE anything else, including verification: a replayed callback of
  // a payment we already banked must be a clean no-op, and re-running the amount
  // check on a paid order only creates ways to fail an already-good outcome.
  if (order.payment.status === 'paid') {
    return { outcome: 'already-paid', orderId: order._id, orderNumber: order.orderNumber };
  }

  // ── Gateway said no ───────────────────────────────────────────────────────
  if (!succeeded) {
    const why = reason || (cancelled ? 'cancelled by buyer' : 'declined at gateway');
    if (!cancelled) await deps.markFailed?.({ orderId: order._id, reason: why });
    return { outcome: 'failed', orderId: order._id, orderNumber: order.orderNumber, reason: why };
  }

  // ── Tamper checks ─────────────────────────────────────────────────────────
  // The browser-redirect callbacks are attacker-controlled: the buyer can edit
  // the query string on the way back. An amount that does not match the order
  // total is the cheapest and most common forgery, so it is refused outright
  // rather than settled for whatever was claimed.
  if (!amountMatches(order.total, paidAmount)) {
    return {
      outcome: 'rejected',
      orderId: order._id,
      orderNumber: order.orderNumber,
      reason: `amount mismatch: gateway reported ${paidAmount}, order total is ${order.total}`,
    };
  }

  // A success with no transaction id is not a receipt of anything.
  const trx = (transactionId || reference || '').trim();
  if (!trx) {
    return {
      outcome: 'rejected',
      orderId: order._id,
      orderNumber: order.orderNumber,
      reason: 'gateway reported success without a transaction id',
    };
  }

  await deps.settle({
    orderId: order._id,
    userId: order.user,
    method: gateway,
    transactionId: trx,
  });

  return { outcome: 'settled', orderId: order._id, orderNumber: order.orderNumber };
};
