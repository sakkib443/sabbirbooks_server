/* eslint-disable no-console */
/**
 * The dashboard counts days the way the shop does: noon to noon.
 *
 * A date names the day that ENDS at its noon — "16 May" is every order placed
 * from 15 May 12:00 up to 16 May 12:00 — which is how the Book Orders screen
 * batches couriers and how the shop keeps its own books. The dashboard used to
 * count calendar days instead, so the two screens disagreed about which day an
 * afternoon order belonged to.
 *
 * Worse, and what this suite would have caught: the chart's rows were built by
 * stepping 24 hours at a time from a UTC instant and reading the date off the
 * wrong side of the +06:00 boundary. Every chart was a day out, the first row
 * was always empty, and the last day of the range — usually today — was
 * missing from both the chart and the totals beside it.
 *
 * Run: npx ts-node --transpile-only src/__tests__/shop-day-stats.e2e.ts
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

/** YYYY-MM-DD in Bangladesh, for building "today" cases at run time. */
const bdDate = (d = new Date()) =>
  new Date(d.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'shop-day-test' });

  const { Order } = await import('../app/modules/order/order.model');
  const { OrderService } = await import('../app/modules/order/order.service');

  const book = new mongoose.Types.ObjectId();
  let seq = 0;
  /** One order, placed at an exact Bangladeshi instant. */
  const placedAt = (bdInstant: string, total = 100) => {
    seq += 1;
    const created = new Date(bdInstant);
    return {
      orderNumber: `ORD-SHOPDAY-${seq}`,
      orderSeq: seq,
      items: [{ book, title: 'MAGIC VIVA ANATOMY', price: total, quantity: 1, format: 'printed' }],
      deliveryType: 'printed',
      subtotal: total,
      discount: 0,
      deliveryCharge: 0,
      total,
      payment: { status: 'pending' },
      status: 'processing',
      createdAt: created,
      updatedAt: created,
    };
  };

  const today = bdDate();

  await Order.insertMany(
    [
      // Either side of 15 May's noon — the boundary the whole thing turns on.
      placedAt('2026-05-15T11:59:00+06:00'), // belongs to 15 May
      placedAt('2026-05-15T12:01:00+06:00'), // belongs to 16 May
      placedAt('2026-05-15T23:30:00+06:00'), // late evening — still 16 May
      placedAt('2026-05-16T07:00:00+06:00'), // next morning — also 16 May
      // Just outside the window asked for below, on both sides.
      placedAt('2026-05-14T11:00:00+06:00'), // 14 May
      placedAt('2026-05-17T15:00:00+06:00'), // 18 May
      // One in the day named by today's date, whatever today is.
      placedAt(`${today}T00:30:00+06:00`),
    ],
    { timestamps: false } as never
  );

  // ── The window is the one that was asked for ───────────────────────────
  const s = await OrderService.getBookOrderStats({ from: '2026-05-15', to: '2026-05-17' });
  const r = s.range as { from: string; to: string; orders: number; daily: Array<{ date: string; orders: number }> };

  check('the range answers with the dates it was asked for', r.from === '2026-05-15' && r.to === '2026-05-17', {
    from: r.from,
    to: r.to,
  });
  check('one row per day asked for, no more', r.daily.length === 3, { rows: r.daily.length });
  check(
    'the rows are those days, in order',
    r.daily.map((d) => d.date).join(',') === '2026-05-15,2026-05-16,2026-05-17',
    r.daily.map((d) => d.date)
  );

  // ── Noon is the boundary ───────────────────────────────────────────────
  const on = (date: string) => r.daily.find((d) => d.date === date)?.orders ?? -1;
  check('11:59 on the 15th belongs to the 15th', on('2026-05-15') === 1, { got: on('2026-05-15') });
  check(
    '12:01 and 11:30 PM on the 15th, and 7 AM on the 16th, all belong to the 16th',
    on('2026-05-16') === 3,
    { got: on('2026-05-16') }
  );
  check('a day nothing was ordered on is a zero, not a gap', on('2026-05-17') === 0, {
    got: on('2026-05-17'),
  });

  // ── Nothing leaks in from outside, and the totals match the rows ───────
  check('the order before the window is not counted', r.orders === 4, { orders: r.orders });
  check(
    'the period total is exactly the sum of the rows — the panel beside the chart cannot disagree with it',
    r.orders === r.daily.reduce((n, d) => n + d.orders, 0),
    { total: r.orders, rows: r.daily.map((d) => d.orders) }
  );

  // ── Today is in the chart, and is the same day the order screen means ──
  const t = await OrderService.getBookOrderStats({ from: today, to: today });
  const tRange = t.range as { daily: Array<{ date: string; orders: number }> };
  const todayRow = tRange.daily.find((d) => d.date === today);
  check('a range ending today holds today — the day that used to fall off the end', todayRow?.orders === 1, {
    today,
    row: todayRow,
  });
  check(
    "the Today card and the chart's last row are the same number",
    (t.today as { orders: number }).orders === todayRow?.orders,
    { card: (t.today as { orders: number }).orders, row: todayRow?.orders }
  );

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
