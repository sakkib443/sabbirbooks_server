/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * What a manager may see of the order book: three days, and no more.
 *
 * The shop's manager packs the parcels going out now. Yesterday's list is
 * still open (a parcel can come back, a buyer can ring), tomorrow's is open
 * (orders taken after noon are already on it), and everything older belongs
 * to the owner — the sales history, the money, the customers.
 *
 * Every check here goes through the real HTTP layer with a real manager's
 * token, because that is the only level at which the rule is worth anything:
 * hiding the buttons is presentation, and a window the browser merely asks
 * for is one anyone can widen by editing a URL.
 *
 * Run: npx ts-node --transpile-only src/__tests__/manager-scope.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

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
  const { addDays, bdDate, cutoffOf } = await import('../app/utils/shopDay');
  const api = () => request(app);

  const book = new mongoose.Types.ObjectId();
  const today = bdDate();
  /** An instant inside the shop day named `day` — an hour before it closes. */
  const insideDay = (day: string) => new Date(cutoffOf(day).getTime() - 60 * 60 * 1000);

  let seq = 0;
  const orderOn = async (day: string, label: string) => {
    seq += 1;
    const at = insideDay(day);
    const doc = await Order.create({
      orderNumber: `ORD-SCOPE-${label}`,
      orderSeq: seq,
      items: [{ book, title: 'MAGIC VIVA ANATOMY', price: 500, quantity: 1, format: 'printed' }],
      deliveryType: 'printed',
      shippingAddress: {
        name: label,
        phone: '01700000000',
        address: 'x',
        city: 'ঢাকা',
        district: 'ঢাকা',
      },
      subtotal: 500,
      discount: 0,
      deliveryCharge: 120,
      total: 620,
      payment: { status: 'pending' },
      status: 'pending',
    });
    // Written straight on, so the order sits in the day we mean whatever the
    // clock says while this runs.
    await Order.collection.updateOne({ _id: doc._id }, { $set: { createdAt: at, updatedAt: at } });
    return String(doc._id);
  };

  const old = await orderOn(addDays(today, -9), 'OLD');
  const yesterday = await orderOn(addDays(today, -1), 'YESTERDAY');
  const now = await orderOn(today, 'TODAY');
  const ahead = await orderOn(addDays(today, 1), 'TOMORROW');

  const signIn = async (email: string, role: string, device: string) => {
    await api().post('/api/auth/register').send({
      firstName: role, lastName: 'T', email, password: 'pass1234', whatsappNumber: '01712345678',
    });
    await User.updateOne({ email }, { status: 'active', role });
    const res = await api().post('/api/auth/login').set('x-device-id', device).send({ email, password: 'pass1234' });
    return res.body?.data?.accessToken as string;
  };

  const managerToken = await signIn('manager@t.com', 'manager', 'dev-manager');
  const adminToken = await signIn('admin@t.com', 'admin', 'dev-admin');

  const list = async (token: string, query = '') =>
    api().get(`/api/orders?limit=100${query}`).set('Authorization', `Bearer ${token}`);

  console.log('\n── the list ───────────────────────────────────');

  const asAdmin = await list(adminToken);
  check('an admin sees every order', asAdmin.body?.meta?.total === 4, { total: asAdmin.body?.meta?.total });

  const asManager = await list(managerToken);
  const nums: string[] = (asManager.body?.data || []).map((o: any) => o.orderNumber);
  check('a manager reaches the list at all', asManager.status === 200, { status: asManager.status });
  check('a manager sees three days of it, not four', asManager.body?.meta?.total === 3, {
    total: asManager.body?.meta?.total,
    nums,
  });
  check(
    'yesterday, today and tomorrow — and not the old one',
    ['ORD-SCOPE-YESTERDAY', 'ORD-SCOPE-TODAY', 'ORD-SCOPE-TOMORROW'].every((n) => nums.includes(n)) &&
      !nums.includes('ORD-SCOPE-OLD'),
    nums
  );

  // The window is narrowed into, never widened: asking for last month gives
  // nothing rather than the manager's own three days.
  const reach = await list(
    managerToken,
    `&from=${cutoffOf(addDays(today, -40)).toISOString()}&to=${cutoffOf(addDays(today, -30)).toISOString()}`
  );
  check('asking for last month answers with nothing', reach.body?.meta?.total === 0, {
    total: reach.body?.meta?.total,
  });

  const oneDay = await list(
    managerToken,
    `&from=${cutoffOf(addDays(today, -2)).toISOString()}&to=${cutoffOf(addDays(today, -1)).toISOString()}`
  );
  check('asking for one day inside the window gives that day', oneDay.body?.meta?.total === 1, {
    total: oneDay.body?.meta?.total,
  });

  console.log('\n── changing an order ──────────────────────────');

  const setStatus = (token: string, id: string) =>
    api().patch(`/api/orders/${id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'processing' });

  const onToday = await setStatus(managerToken, now);
  check("a manager confirms today's order", onToday.status === 200, { status: onToday.status, body: onToday.body?.message });

  const onOld = await setStatus(managerToken, old);
  check('a manager cannot touch an order from last week', onOld.status === 403, { status: onOld.status });

  const bulk = await api()
    .patch('/api/orders/bulk-status')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ ids: [yesterday, old], status: 'processing' });
  check('one out-of-window id refuses the whole bulk change', bulk.status === 403, { status: bulk.status });

  const bulkOk = await api()
    .patch('/api/orders/bulk-status')
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ ids: [yesterday, ahead], status: 'processing' });
  check('a bulk change inside the window goes through', bulkOk.status === 200, { status: bulkOk.status });

  const note = await api()
    .patch(`/api/orders/${old}/note`)
    .set('Authorization', `Bearer ${managerToken}`)
    .send({ adminNote: 'peeking' });
  check('nor annotate one', note.status === 403, { status: note.status });

  const adminOnOld = await setStatus(adminToken, old);
  check('an admin still can', adminOnOld.status === 200, { status: adminOnOld.status });

  console.log('\n── the dashboard ──────────────────────────────');

  const stats = async (token: string, query = '') =>
    api().get(`/api/orders/stats${query}`).set('Authorization', `Bearer ${token}`);

  const mStats = (await stats(managerToken)).body?.data;
  check('a manager reaches the dashboard numbers', !!mStats, { mStats });
  check(
    'over two days: yesterday and today',
    mStats?.range?.from === addDays(today, -1) && mStats?.range?.to === today,
    { from: mStats?.range?.from, to: mStats?.range?.to }
  );
  check('two rows in the chart', (mStats?.range?.daily || []).length === 2, {
    rows: (mStats?.range?.daily || []).length,
  });
  // The figure that reads "all time" on the page is the window's, not the
  // shop's lifetime — otherwise hiding the chart would be a lock on an open
  // window.
  check('"all time" is the window too — two orders, not four', mStats?.totals?.orders === 2, {
    orders: mStats?.totals?.orders,
  });

  const wide = (await stats(managerToken, `?from=${addDays(today, -60)}&to=${today}`)).body?.data;
  check('asking the dashboard for sixty days still answers with two', wide?.range?.from === addDays(today, -1), {
    from: wide?.range?.from,
  });

  const aStats = (await stats(adminToken)).body?.data;
  check('an admin still sees every order in the lifetime figure', aStats?.totals?.orders === 4, {
    orders: aStats?.totals?.orders,
  });

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
