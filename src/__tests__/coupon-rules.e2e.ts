/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Coupon rules — the window, the counters, the conditions, the money.
 *
 * Every limit on a coupon is opt-in, and the whole risk of adding them is that
 * a coupon written before they existed starts refusing buyers. So the first
 * test here is the bare coupon: no dates, no caps, no restrictions, still
 * works. The rest each turn on exactly one rule.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the live database, and a test that created coupons
 * there would change what real buyers are charged. DATABASE_URL is overwritten
 * with the memory server's URI before a single module is imported, so even a
 * module that connects on import cannot reach production.
 *
 * Run: npx ts-node src/__tests__/coupon-rules.e2e.ts
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
};

/** Did this throw, and did it complain about the thing we expected? */
const rejects = async (fn: () => Promise<unknown>, needle: string) => {
  try {
    await fn();
    return { threw: false, matched: false, message: '(no error)' };
  } catch (e: any) {
    const message = String(e?.message || e);
    return { threw: true, matched: message.includes(needle), message };
  }
};

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'coupon-rules-test' });

  const { BookCoupon } = await import('../app/modules/bookCoupon/bookCoupon.model');
  const { Order } = await import('../app/modules/order/order.model');

  /**
   * A row the per-buyer count can see.
   *
   * Inserted through the driver rather than the model on purpose: a valid
   * Order needs items, a delivery type and an address, none of which this
   * rule reads. Building one would test the order schema instead of the
   * coupon, and would break this file every time that schema gained a field.
   */
  const orderUsing = (code: string, user: unknown, status: string) =>
    Order.collection.insertOne({
      user,
      couponCode: code,
      status,
      // orderNumber carries a unique index, so two rows both missing it
      // collide on null rather than inserting.
      orderNumber: `TEST-${code}-${status}`,
    } as never);
  const { evaluateBookCoupon } = await import('../app/modules/bookCoupon/bookCoupon.controller');

  const buyer = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  let n = 0;
  /** A coupon with nothing set but what the test is about. */
  const make = (over: Record<string, unknown> = {}) =>
    BookCoupon.create({ code: `T${++n}`, discountType: 'percent', discountValue: 10, ...over });

  console.log('\n── A coupon with no limits at all ──────────────────────');
  {
    // The migration guarantee. Everything below adds a way to say no; this is
    // the test that fails loudly if one of them starts saying no by default.
    await make({ code: 'BARE' });
    const r = await evaluateBookCoupon('BARE', 1000);
    check('still applies', r.discountAmount === 100, r.discountAmount);
    check('waives no delivery', r.deliveryDiscount === 0, r.deliveryDiscount);
  }

  console.log('\n── The window ─────────────────────────────────────────');
  {
    await make({ code: 'FUTURE', validFrom: new Date(Date.now() + 3 * DAY) });
    const r = await rejects(() => evaluateBookCoupon('FUTURE', 1000), 'starts on');
    check('a coupon that has not opened yet says when it does', r.matched, r.message);

    await make({ code: 'PAST', validUntil: new Date(Date.now() - DAY) });
    const e = await rejects(() => evaluateBookCoupon('PAST', 1000), 'expired');
    check('an expired coupon is refused', e.matched, e.message);

    await make({
      code: 'OPEN',
      validFrom: new Date(Date.now() - DAY),
      validUntil: new Date(Date.now() + DAY),
    });
    const ok = await evaluateBookCoupon('OPEN', 1000);
    check('a coupon inside its window applies', ok.discountAmount === 100, ok.discountAmount);
  }

  console.log('\n── The counters ───────────────────────────────────────');
  {
    await make({ code: 'FULL', maxUses: 5, usedCount: 5 });
    const r = await rejects(() => evaluateBookCoupon('FULL', 1000), 'usage limit');
    check('a used-up coupon is refused', r.matched, r.message);

    await make({ code: 'NEARLY', maxUses: 5, usedCount: 4 });
    const ok = await evaluateBookCoupon('NEARLY', 1000);
    check('one use left still works', ok.discountAmount === 100, ok.discountAmount);

    // Per-buyer is counted from the orders, so it needs orders to count.
    await make({ code: 'ONEEACH', maxUsesPerBuyer: 1 });
    await orderUsing('ONEEACH', buyer, 'processing');
    const used = await rejects(
      () => evaluateBookCoupon('ONEEACH', 1000, { userId: buyer }),
      'already used'
    );
    check('the buyer who used it is refused', used.matched, used.message);

    const fresh = await evaluateBookCoupon('ONEEACH', 1000, { userId: other });
    check('a different buyer still gets it', fresh.discountAmount === 100, fresh.discountAmount);

    // The rule that makes the count worth doing from orders rather than a tally.
    await make({ code: 'CANCELLED', maxUsesPerBuyer: 1 });
    await orderUsing('CANCELLED', buyer, 'cancelled');
    const after = await evaluateBookCoupon('CANCELLED', 1000, { userId: buyer });
    check(
      'a cancelled order does not burn the buyer’s one use',
      after.discountAmount === 100,
      after.discountAmount
    );

    // Without a buyer id the per-buyer rule cannot be checked. It must skip,
    // not fail — the preview does not always know who is asking.
    const anon = await evaluateBookCoupon('ONEEACH', 1000);
    check('no buyer id → the per-buyer rule is skipped', anon.discountAmount === 100);
  }

  console.log('\n── The conditions ─────────────────────────────────────');
  {
    await make({ code: 'MIN500', minPurchase: 500 });
    const under = await rejects(() => evaluateBookCoupon('MIN500', 400), 'at least BDT 500');
    check('under the minimum is refused, and says the number', under.matched, under.message);
    const on = await evaluateBookCoupon('MIN500', 500);
    check('exactly the minimum qualifies', on.discountAmount === 50, on.discountAmount);

    await make({ code: 'CODONLY', appliesTo: 'cod' });
    const wrong = await rejects(
      () => evaluateBookCoupon('CODONLY', 1000, { paymentMethod: 'sslcommerz' }),
      'cash on delivery'
    );
    check('a COD-only code refuses a prepaid order', wrong.matched, wrong.message);
    const right = await evaluateBookCoupon('CODONLY', 1000, { paymentMethod: 'cod' });
    check('and applies to a COD order', right.discountAmount === 100);
    const unknown = await evaluateBookCoupon('CODONLY', 1000);
    check('no method known → the rule is skipped', unknown.discountAmount === 100);

    await make({ code: 'ONLINEONLY', appliesTo: 'online' });
    const cod = await rejects(
      () => evaluateBookCoupon('ONLINEONLY', 1000, { paymentMethod: 'cod' }),
      'pay online'
    );
    check('an online-only code refuses COD', cod.matched, cod.message);
  }

  console.log('\n── The money ──────────────────────────────────────────');
  {
    await make({ code: 'CAPPED', discountValue: 20, maxDiscount: 100 });
    const capped = await evaluateBookCoupon('CAPPED', 1000);
    check('20% of 1000 is capped at 100', capped.discountAmount === 100, capped.discountAmount);
    const under = await evaluateBookCoupon('CAPPED', 400);
    check('and under the cap it is the plain percentage', under.discountAmount === 80, under.discountAmount);

    // A fixed amount is its own ceiling; the cap must not silently apply.
    await make({ code: 'FIXEDCAP', discountType: 'fixed', discountValue: 300, maxDiscount: 100 });
    const fixed = await evaluateBookCoupon('FIXEDCAP', 1000);
    check('maxDiscount is ignored for a fixed amount', fixed.discountAmount === 300, fixed.discountAmount);

    await make({ code: 'HUGE', discountType: 'fixed', discountValue: 5000 });
    const clamped = await evaluateBookCoupon('HUGE', 600);
    check('a fixed amount never exceeds the price', clamped.discountAmount === 600, clamped.discountAmount);

    await make({ code: 'SHIPFREE', discountValue: 0, freeDelivery: true });
    const ship = await evaluateBookCoupon('SHIPFREE', 1000, { deliveryCharge: 120 });
    check('free delivery waives the charge', ship.deliveryDiscount === 120, ship.deliveryDiscount);
    check('and takes nothing off the books', ship.discountAmount === 0, ship.discountAmount);

    const already = await evaluateBookCoupon('SHIPFREE', 1000, { deliveryCharge: 0 });
    check(
      'waiving an already-free delivery is worth zero, not negative',
      already.deliveryDiscount === 0,
      already.deliveryDiscount
    );

    // The combination the flag exists for.
    await make({ code: 'BOTH', discountValue: 10, freeDelivery: true });
    const both = await evaluateBookCoupon('BOTH', 1000, { deliveryCharge: 120 });
    check(
      'a coupon can discount AND waive delivery',
      both.discountAmount === 100 && both.deliveryDiscount === 120,
      { d: both.discountAmount, s: both.deliveryDiscount }
    );
  }

  console.log('\n── Still refused for the old reasons ──────────────────');
  {
    await make({ code: 'OFF', isActive: false });
    const off = await rejects(() => evaluateBookCoupon('OFF', 1000), 'not active');
    check('an inactive coupon is refused', off.matched, off.message);
    const missing = await rejects(() => evaluateBookCoupon('NOSUCHCODE', 1000), 'Invalid coupon');
    check('an unknown code is refused', missing.matched, missing.message);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
