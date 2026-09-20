/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Moving orders to the day they actually go out
 * (isolated in-memory MongoDB, real Express app via supertest; never the live DB).
 *
 * The shop batches a college's orders: three days of Cumilla orders leave
 * together on the 21st. So an order moved to the 21st has to appear in the
 * 21st's list and — the half that is easy to get wrong — disappear from the
 * list for the day it was placed, or it gets packed twice.
 *
 * Run:  npx ts-node --transpile-only src/__tests__/order-dispatch-date.e2e.ts
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
  const ids: Record<string, string> = {};
  const placedAt = async (label: string, iso: string) => {
    const o = await Order.create({
      items: [{ book, title: label, price: 650, quantity: 1, format: 'printed' }],
      deliveryType: 'printed',
      shippingAddress: { name: label, phone: '01711111111', address: 'Hall', city: 'শাহবাগ' },
      subtotal: 650, total: 650, status: 'pending',
    } as any);
    await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: new Date(iso) } });
    ids[label] = String(o._id);
  };

  // Two orders on the 19th's list, one on the 20th's. (A day named N runs from
  // N-1 12:00 BD to N 12:00 BD, so these instants sit inside those days.)
  await placedAt('A', '2026-09-18T07:00:00.000Z'); // 18 Sep 1 PM BD → the 19th
  await placedAt('B', '2026-09-18T20:00:00.000Z'); // 19 Sep 2 AM BD → the 19th
  await placedAt('C', '2026-09-19T20:00:00.000Z'); // 20 Sep 2 AM BD → the 20th

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
  const move = async (labels: string[], dispatchDate: string | null) =>
    api()
      .patch('/api/orders/bulk-dispatch-date')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: labels.map((l) => ids[l]), dispatchDate });

  // Window for one named day: [that day - 1 at noon BD, that day at noon BD).
  const day = (d: string) => ({ from: `2026-09-${d}T06:00:00.000Z` });
  const DAY19 = '&from=2026-09-18T06:00:00.000Z&to=2026-09-19T06:00:00.000Z';
  const DAY20 = '&from=2026-09-19T06:00:00.000Z&to=2026-09-20T06:00:00.000Z';
  const DAY21 = '&from=2026-09-20T06:00:00.000Z&to=2026-09-21T06:00:00.000Z';

  console.log('\n── Before anything is moved ──');
  {
    check((await list(DAY19)).names === 'AB', '19th holds A and B');
    check((await list(DAY20)).names === 'C', '20th holds C');
    check((await list(DAY21)).names === '', '21st is empty');
  }

  console.log('\n── Moved to the 21st ──');
  {
    // The screen sends the instant the chosen day opens: 20 Sep noon BD.
    const res = await move(['A', 'B', 'C'], day('20').from);
    check(res.status === 200 && res.body?.data?.updated === 3, `all three moved (${res.body?.data?.updated})`, res.body);
    check((await list(DAY21)).names === 'ABC', '21st now holds all three');
    check((await list(DAY19)).names === '', 'the 19th is empty — they are not on two lists');
    check((await list(DAY20)).names === '', 'the 20th is empty too');
    const all = await list('');
    check(all.names === 'ABC' && all.total === 3, 'with no date filter every order is still there', all);
  }

  console.log('\n── Moved back ──');
  {
    const res = await move(['B'], null);
    check(res.status === 200, 'null puts an order back on its order date');
    check((await list(DAY19)).names === 'B', 'B answers on the 19th again');
    check((await list(DAY21)).names === 'AC', 'and is gone from the 21st');
  }

  console.log('\n── What it refuses ──');
  {
    const none = await api()
      .patch('/api/orders/bulk-dispatch-date')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [], dispatchDate: day('20').from });
    check(none.status === 400, 'no orders selected → 400', none.body?.message);

    const bad = await move(['A'], 'whenever');
    check(bad.status === 400 && /Invalid date/i.test(bad.body?.message || ''), 'a date that is not a date → 400', bad.body?.message);

    const noAuth = await api().patch('/api/orders/bulk-dispatch-date').send({ ids: [ids.A], dispatchDate: null });
    check(noAuth.status === 401 || noAuth.status === 403, `not signed in → ${noAuth.status}`);
  }

  console.log('\n── It moves nothing else ──');
  {
    const a: any = await Order.findById(ids.A).lean();
    check(a?.status === 'pending', 'the status is untouched', a?.status);
    check(!a?.shippedAt && !a?.confirmedAt, 'no fulfilment timestamps were stamped');
    check(!Array.isArray(a?.smsSent) || a.smsSent.length === 0, 'no text was sent', a?.smsSent);
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
