/* eslint-disable no-console */
/**
 * One-time (idempotent) backfill for the human-friendly order number `orderSeq`.
 *
 * Numbers every existing order 1..N by creation order and sets the `order`
 * counter to N, so the next order created continues from N+1. Safe to run more
 * than once: createdAt never changes, so a re-run assigns the exact same numbers
 * and only writes the rows that are actually wrong.
 *
 * Run against the live DB (DATABASE_URL from .env):
 *   npx ts-node src/scripts/backfillOrderSeq.ts
 */
import mongoose from 'mongoose';
import { Order } from '../app/modules/order/order.model';
import { Counter, ORDER_SEQ } from '../app/modules/order/counter.model';

export const backfillOrderSeq = async (): Promise<{
  total: number;
  updated: number;
  max: number;
}> => {
  // _id tiebreaker keeps the order deterministic when two rows share a createdAt.
  const orders = await Order.find({}, { orderSeq: 1, createdAt: 1 }).sort({
    createdAt: 1,
    _id: 1,
  });

  const ops: Parameters<typeof Order.bulkWrite>[0] = [];
  let updated = 0;
  orders.forEach((o, i) => {
    const seq = i + 1;
    if (o.orderSeq !== seq) {
      ops.push({ updateOne: { filter: { _id: o._id }, update: { $set: { orderSeq: seq } } } });
      updated++;
    }
  });
  if (ops.length) await Order.bulkWrite(ops);

  const max = orders.length;
  // Bring the counter up to N so createOrder's next value is N+1 (never a
  // collision with a number just assigned above).
  await Counter.updateOne({ _id: ORDER_SEQ }, { $set: { seq: max } }, { upsert: true });

  return { total: orders.length, updated, max };
};

// CLI entry — connect, run, disconnect.
if (require.main === module) {
  (async () => {
    // Importing config loads .env; dbConnect reads process.env.DATABASE_URL.
    await import('../app/config');
    const { dbConnect } = await import('../app/utils/dbConnect');
    await dbConnect();
    const res = await backfillOrderSeq();
    console.log(
      `✅ Order backfill done — ${res.total} orders, ${res.updated} updated, counter set to ${res.max}`,
    );
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => {
    console.error('❌ Order backfill failed:', e);
    process.exit(1);
  });
}
