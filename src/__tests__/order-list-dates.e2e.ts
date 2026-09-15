/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * The admin order list, narrowed to a time window
 * (isolated in-memory MongoDB, real Express app via supertest; never the live DB).
 *
 * The Book Orders screen counts a day from 3 PM to 3 PM Bangladesh time and
 * sends the exact instants: "16 Sep" is 15 Sep 15:00 BD (09:00Z) up to
 * 16 Sep 15:00 BD (09:00Z). The start is included, the end is not.
 *
 * Run:  npx ts-node --transpile-only src/__tests__/order-list-dates.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
  }
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Order } = await import('../app/modules/order/order.model');
  const { User } = await import('../app/modules/user/user.model');
  const api = () => request(app);

  const book = new mongoose.Types.ObjectId();
  const placedAt = async (label: string, iso: string, status = 'pending') => {
    const o = await Order.create({
      items: [{ book, title: label, price: 650, quantity: 1, format: 'printed' }],
      deliveryType: 'printed',
      shippingAddress: { name: label, phone: '01711111111', address: 'Hall', city: 'শাহবাগ' },
      subtotal: 650, total: 650, status,
    } as any);
    await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: new Date(iso) } });
  };

  // 15 Sep 14:59:59 BD — the last second of the 15 Sep day.
  await placedAt('A', '2026-09-15T08:59:59.000Z');
  // 15 Sep 15:00:00 BD — the first second of the 16 Sep day.
  await placedAt('B', '2026-09-15T09:00:00.000Z', 'delivered');
  // 16 Sep 14:59:59 BD — still the 16 Sep day.
  await placedAt('C', '2026-09-16T08:59:59.000Z');
  // 16 Sep 15:00:00 BD — already the 17 Sep day.
  await placedAt('D', '2026-09-16T09:00:00.000Z');

  await api().post('/api/auth/register').send({
    firstName: 'A', lastName: 'B', email: 'admin@t.com', password: 'pass1234', whatsappNumber: '01712345678',
  });
  await User.updateOne({ email: 'admin@t.com' }, { status: 'active', role: 'admin' });
  const token = (
    await api().post('/api/auth/login').set('x-device-id', 'dev-admin').send({ email: 'admin@t.com', password: 'pass1234' })
  ).body?.data?.accessToken;

  const list = async (qs: string) => {
    const r = await api().get(`/api/orders?limit=500${qs}`).set('Authorization', `Bearer ${token}`);
    const names = (r.body?.data || []).map((o: any) => o.items?.[0]?.title).sort().join('');
    return { status: r.status, names, total: r.body?.meta?.total, message: r.body?.message };
  };

  const DAY16_FROM = '2026-09-15T09:00:00.000Z';
  const DAY16_TO = '2026-09-16T09:00:00.000Z';

  console.log('\n── One 3 PM → 3 PM day ──');
  {
    const r = await list(`&from=${DAY16_FROM}&to=${DAY16_TO}`);
    check(r.status === 200 && r.names === 'BC', `"16 Sep" holds B (15 Sep 3:00 PM) and C (16 Sep 2:59 PM) — not A or D (got ${r.names})`, r);
    check(r.total === 2, `meta.total counts the window, not every order (${r.total})`);
  }

  console.log('\n── Open-ended and combined ──');
  {
    const onlyFrom = await list(`&from=${DAY16_FROM}`);
    check(onlyFrom.names === 'BCD', `from alone: B, C, D (${onlyFrom.names})`);
    const onlyTo = await list(`&to=${DAY16_TO}`);
    check(onlyTo.names === 'ABC', `to alone: A, B, C (${onlyTo.names})`);
    const withStatus = await list(`&status=delivered&from=${DAY16_FROM}&to=${DAY16_TO}`);
    check(withStatus.names === 'B', `with a status filter too: only the delivered B (${withStatus.names})`);
    const everything = await list('');
    check(everything.names === 'ABCD', `no window: every order, as before (${everything.names})`);
  }

  console.log('\n── Bad input ──');
  {
    const bad = await list('&from=yesterday');
    check(bad.status === 400 && /Invalid date range/.test(bad.message || ''), `a date that is not a date → 400 (${bad.status})`, bad.message);
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
