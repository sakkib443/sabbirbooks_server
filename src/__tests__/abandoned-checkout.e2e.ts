/* eslint-disable no-console */
/**
 * What happens to an order whose buyer never paid (isolated in-memory MongoDB —
 * never touches the live DB).
 *
 * An order is written BEFORE the buyer is sent to SSLCommerz, so that closing
 * the tab after paying still produces the order the IPN settles. The price of
 * that design is the case this file pins down: a buyer who reaches the payment
 * page and comes back without paying must not leave a pending order behind.
 *
 * The rules:
 *   cancel / fail callback  → order cancelled, not merely payment failed
 *   no callback at all      → swept after the abandonment window
 *   COD                     → never swept; it is a real order when placed
 *   manual (Send Money)     → never swept; it is SUPPOSED to sit unpaid
 *   paid                    → a late decline can never cancel banked money
 *   alerts                  → a gateway order announces itself when paid, not
 *                             when opened; a COD order announces immediately
 *
 * Run:  npx ts-node src/__tests__/abandoned-checkout.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';

  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Order } = await import('../app/modules/order/order.model');
  const { Book } = await import('../app/modules/book/book.model');
  const { OrderService } = await import('../app/modules/order/order.service');
  const { mongoSettlementDeps } = await import('../app/modules/payment/orderSettlement.deps');

  const book = await Book.create({
    id: 1,
    title: 'Anatomy MAGIC VIVA',
    slug: 'anatomy-magic-viva',
    price: 500,
    author: 'Sabbir',
    category: 'medical',
    description: 'test',
    format: 'printed',
    stock: 100,
  });

  let n = 0;
  /** An order in whatever half-finished state a test needs. */
  const mkOrder = async (opts: {
    method?: string;
    paymentStatus?: string;
    status?: string;
    minutesAgo?: number;
  }) => {
    n++;
    const created = new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000);
    const order = await Order.create({
      user: new mongoose.Types.ObjectId(),
      orderNumber: `INV-${1000 + n}`,
      items: [{ book: book._id, title: book.title, price: 500, quantity: 1, format: 'printed' }],
      deliveryType: 'printed',
      subtotal: 500,
      total: 500,
      shippingAddress: { name: 'B', phone: '01700000000', address: 'a', city: 'Dhaka' },
      payment: {
        ...(opts.method ? { method: opts.method } : {}),
        status: opts.paymentStatus ?? 'pending',
      },
      status: opts.status ?? 'pending',
    });
    // createdAt is set by mongoose timestamps; the sweep filters on it, so a
    // test that needs an OLD order has to move it back. Through the raw driver:
    // mongoose marks a timestamped `createdAt` immutable, and a $set on it via
    // the model is dropped without complaint — which reads, from the test's
    // side, exactly like a sweep that does not work.
    if (opts.minutesAgo) {
      await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: created } });
    }
    return order;
  };

  const reload = (id: any) => Order.findById(id).lean();

  // ───────────────────────────────────────────────────────────
  console.log('\n── Cancel / fail at the gateway closes the order ──');
  {
    const o = await mkOrder({ method: 'sslcommerz' });
    await mongoSettlementDeps.markFailed!({ orderId: String(o._id), reason: 'cancelled by buyer' });
    const after: any = await reload(o._id);
    check(after.status === 'cancelled', `order status → cancelled (got '${after.status}')`);
    check(after.payment.status === 'failed', 'payment status → failed');
    check(after.payment.note === 'cancelled by buyer', 'the reason is recorded on the order');
    check(!!after.cancelledAt, 'cancelledAt is stamped');
  }

  // The bug this file exists for: before the fix, only payment.status moved and
  // the order stayed 'pending' — which is exactly what the admin queue lists.
  {
    const o = await mkOrder({ method: 'sslcommerz' });
    await mongoSettlementDeps.markFailed!({ orderId: String(o._id), reason: 'declined' });
    const stillPending = await Order.countDocuments({ _id: o._id, status: 'pending' });
    check(stillPending === 0, 'a failed gateway order is no longer in the pending queue');
  }

  console.log('\n── A decline can never cancel money already banked ──');
  {
    const o = await mkOrder({ method: 'sslcommerz', paymentStatus: 'paid', status: 'processing' });
    await mongoSettlementDeps.markFailed!({ orderId: String(o._id), reason: 'late decline' });
    const after: any = await reload(o._id);
    check(after.payment.status === 'paid', 'paid order stays paid');
    check(after.status === 'processing', 'and keeps its fulfillment status');
  }

  console.log('\n── The buyer who never came back at all ──');
  {
    const fresh = await mkOrder({ method: 'sslcommerz', minutesAgo: 10 });
    const old = await mkOrder({ method: 'sslcommerz', minutesAgo: 200 });

    const closed = await OrderService.expireAbandonedGatewayOrders();
    check(closed === 1, `swept exactly the stale one (closed ${closed})`);

    const a: any = await reload(old._id);
    const b: any = await reload(fresh._id);
    check(a.status === 'cancelled', 'a checkout abandoned 200 minutes ago is closed');
    check(b.status === 'pending', 'one abandoned 10 minutes ago is left alone');
  }

  console.log('\n── Methods where "unpaid" is a normal resting state ──');
  {
    // COD is a real order the moment it is placed; manual (Send Money) is
    // supposed to sit unpaid until the buyer submits and an admin verifies.
    // Sweeping either would delete a genuine order.
    const cod = await mkOrder({ method: 'cod', minutesAgo: 500 });
    const manual = await mkOrder({ method: 'manual', minutesAgo: 500 });
    // An order created but never sent to any gateway carries no method at all.
    const noMethod = await mkOrder({ minutesAgo: 500 });

    const closed = await OrderService.expireAbandonedGatewayOrders();
    check(closed === 0, `nothing swept (closed ${closed})`);
    for (const [label, o] of [
      ['COD', cod],
      ['manual', manual],
      ['method-less', noMethod],
    ] as const) {
      const after: any = await reload(o._id);
      check(after.status === 'pending', `${label} order untouched by the sweep`);
    }
  }

  console.log('\n── Sweeping twice changes nothing the second time ──');
  {
    await mkOrder({ method: 'sslcommerz', minutesAgo: 300 });
    const first = await OrderService.expireAbandonedGatewayOrders();
    const second = await OrderService.expireAbandonedGatewayOrders();
    check(first === 1 && second === 0, `idempotent (${first} then ${second})`);
  }

  console.log('\n── An unpaid gateway order announces nothing ──');
  {
    // alertsSentAt is the stamp that decides whether the shop has been told
    // about this order. A gateway order must not carry it before payment.
    const o = await mkOrder({ method: 'sslcommerz' });
    const before: any = await reload(o._id);
    check(!before.alertsSentAt, 'no "new order" alert raised for an unpaid gateway order');

    await OrderService.abandonUnpaidGatewayOrder(String(o._id), 'never paid');
    const after: any = await reload(o._id);
    check(!after.alertsSentAt, 'and none is raised when it is closed either');
  }

  console.log('\n── Paying it is what announces it ──');
  {
    const o = await mkOrder({ method: 'sslcommerz' });
    await OrderService.completePayment(String(o._id), String(o.user), {
      method: 'sslcommerz',
      transactionId: 'TRX-TEST-1',
    });
    const after: any = await reload(o._id);
    check(after.payment.status === 'paid', 'settling marks it paid');
    check(!!after.alertsSentAt, 'and raises the alerts that were held back');

    // Second settlement (a replayed callback) must not announce it again.
    const stamp = String(after.alertsSentAt);
    await OrderService.completePayment(String(o._id), String(o.user), {
      method: 'sslcommerz',
      transactionId: 'TRX-TEST-1',
    });
    const again: any = await reload(o._id);
    check(String(again.alertsSentAt) === stamp, 'a replayed callback does not announce it twice');
  }

  await mongoose.disconnect();
  await mongod.stop();

  console.log(
    failed === 0
      ? `\n✅ ALL PASS — ${passed} passed, 0 failed`
      : `\n❌ FAILURES — ${passed} passed, ${failed} failed`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});
