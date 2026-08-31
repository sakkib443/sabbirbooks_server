/* eslint-disable no-console */
/**
 * Throwaway E2E for the 15-Aug order features (isolated in-memory MongoDB, real
 * Express app driven via supertest — never touches the live DB):
 *
 *   N2  orderSeq          — new orders get 1,2,3…; GET returns it; counter is atomic
 *   N2  backfill          — legacy rows (no orderSeq) get numbered 1..N, counter → N
 *   N2  seed/collision    — an order placed BEFORE the backfill still converges
 *   N5  timeline ladder   — a COD order sits on step 1 until the admin confirms,
 *                           then advances exactly one step per admin action
 *
 * Run:  npx ts-node src/__tests__/orders-newfeatures.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Ported EXACTLY from the frontend orderUi.js so we assert the same mapping the
// buyer's tracking page uses. "current step" is driven by fulfillment timestamps,
// not the payment-coloured status. (0 = Order placed, 1 = Confirmed, 2 = Shipped,
// 3 = Delivered.)
const printedIndex = (order: any): number => {
  const s = order?.status;
  if (order?.deliveredAt || s === 'delivered') return 3;
  if (order?.shippedAt || s === 'shipped') return 2;
  if (order?.confirmedAt || s === 'processing' || s === 'access-granted') return 1;
  return 0;
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Order } = await import('../app/modules/order/order.model');
  const { Counter, ORDER_SEQ } = await import('../app/modules/order/counter.model');
  const { Book } = await import('../app/modules/book/book.model');
  const { User } = await import('../app/modules/user/user.model');
  const { backfillOrderSeq } = await import('../scripts/backfillOrderSeq');

  const api = () => request(app);
  console.log(`🗄️  In-memory MongoDB ready\n`);

  // ── shared fixtures ────────────────────────────────────────
  const makeBook = async (id: number, slug: string) =>
    Book.create({ id, title: `Book ${id}`, slug, price: 100, format: 'printed', stock: 500 });

  const registerLogin = async (email: string, device: string, role?: string) => {
    // whatsappNumber is required at signup — every customer is reached there
    // about their order. A fixture without one gets a 400 and every assertion
    // below it fails for a reason that has nothing to do with orders.
    await api()
      .post('/api/auth/register')
      .send({
        firstName: 'T',
        lastName: 'U',
        email,
        password: 'pass1234',
        whatsappNumber: '01712345678',
      });
    // A medical college is required before anyone can order (createOrder
    // refuses without one — it is how deliveries are routed). Registration does
    // not ask for it, so every fixture below would otherwise get a 400 from
    // /api/orders and fail for a reason that has nothing to do with orders.
    await User.updateOne(
      { email },
      { ...(role ? { role } : {}), medicalCollegeName: 'Khulna Medical College' }
    );
    const res = await api()
      .post('/api/auth/login')
      .set('x-device-id', device)
      .send({ email, password: 'pass1234' });
    return res.body?.data?.accessToken as string;
  };

  const placeCod = (token: string, slug: string) =>
    api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ bookSlugOrId: slug, quantity: 1 }],
        shippingAddress: { name: 'Buyer', phone: '01700000000', address: 'Rd 1', city: 'Dhaka' },
        paymentMethod: 'cod',
      });

  const getOrder = (token: string, id: string) =>
    api().get(`/api/orders/${id}`).set('Authorization', `Bearer ${token}`);

  const setStatus = (adminToken: string, id: string, status: string) =>
    api()
      .patch(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status });

  const reset = async () => {
    await Order.deleteMany({});
    await Counter.deleteMany({});
  };

  const student = await registerLogin('buyer@test.com', 'sd1');
  const admin = await registerLogin('admin@test.com', 'ad1', 'superAdmin');
  await makeBook(1, 'book-1');

  // ─────────────────────────────────────────────────────────────
  // N2 (a) — fresh DB: new orders get 1, 2, 3 in creation order
  // ─────────────────────────────────────────────────────────────
  console.log('N2 (a) — sequential numbers on new orders');
  await reset();
  const seqs: number[] = [];
  let firstId = '';
  for (let i = 0; i < 3; i++) {
    const r = await placeCod(student, 'book-1');
    seqs.push(r.body?.data?.orderSeq);
    if (i === 0) firstId = r.body?.data?._id;
    await sleep(4);
  }
  check(JSON.stringify(seqs) === JSON.stringify([1, 2, 3]), `new orders numbered 1,2,3 (got ${seqs})`);
  const counterA = await Counter.findById(ORDER_SEQ);
  check(counterA?.seq === 3, `counter reached 3 (got ${counterA?.seq})`);
  const fetched = await getOrder(student, firstId);
  check(fetched.body?.data?.orderSeq === 1, 'GET /orders/:id returns orderSeq');

  // ─────────────────────────────────────────────────────────────
  // N2 (b) — backfill numbers legacy rows 1..N by creation order
  // ─────────────────────────────────────────────────────────────
  console.log('N2 (b) — backfill of legacy rows (no orderSeq)');
  await reset();
  const legacyIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    // Insert directly, bypassing the service → no orderSeq, like pre-feature rows.
    const o = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ book: new mongoose.Types.ObjectId(), title: 'X', price: 100, quantity: 1, format: 'printed' }],
      deliveryType: 'printed',
      subtotal: 100,
      total: 100,
      payment: { status: 'pending' },
      status: 'pending',
    });
    legacyIds.push(o._id.toString());
    await sleep(4);
  }
  const hadNone = (await Order.find({ orderSeq: { $exists: true } })).length === 0;
  check(hadNone, 'legacy rows start with no orderSeq');
  const res = await backfillOrderSeq();
  check(res.total === 3 && res.updated === 3 && res.max === 3, `backfill: total/updated/max = 3 (got ${JSON.stringify(res)})`);
  const afterSeqs = (await Order.find().sort({ createdAt: 1 })).map((o: any) => o.orderSeq);
  check(JSON.stringify(afterSeqs) === JSON.stringify([1, 2, 3]), `legacy rows numbered 1,2,3 by createdAt (got ${afterSeqs})`);
  const rerun = await backfillOrderSeq();
  check(rerun.updated === 0, 'backfill is idempotent (re-run changes nothing)');
  // A brand-new order after backfill continues from N+1.
  const afterBackfill = await placeCod(student, 'book-1');
  check(afterBackfill.body?.data?.orderSeq === 4, `next new order = 4 (got ${afterBackfill.body?.data?.orderSeq})`);

  // ─────────────────────────────────────────────────────────────
  // N2 (c) — order placed BEFORE backfill still converges (seed guard)
  // ─────────────────────────────────────────────────────────────
  console.log('N2 (c) — new order before backfill converges');
  await reset();
  const preIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const o = await Order.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ book: new mongoose.Types.ObjectId(), title: 'X', price: 100, quantity: 1, format: 'printed' }],
      deliveryType: 'printed', subtotal: 100, total: 100, payment: { status: 'pending' }, status: 'pending',
    });
    preIds.push(o._id.toString());
    await sleep(4);
  }
  // New order via the service seeds the counter to the current count (2) → gets 3.
  const early = await placeCod(student, 'book-1');
  check(early.body?.data?.orderSeq === 3, `order before backfill seeded above legacy → 3 (got ${early.body?.data?.orderSeq})`);
  const conv = await backfillOrderSeq();
  const convSeqs = (await Order.find().sort({ createdAt: 1 })).map((o: any) => o.orderSeq);
  check(JSON.stringify(convSeqs) === JSON.stringify([1, 2, 3]), `after backfill: 1,2,3 with the new order last (got ${convSeqs})`);
  check(conv.max === 3, 'counter left at 3 — no gap, no collision');

  // ─────────────────────────────────────────────────────────────
  // N5 — timeline advances exactly one step per admin action
  // ─────────────────────────────────────────────────────────────
  console.log('N5 — order-tracking ladder (COD lifecycle)');
  await reset();
  const placed = await placeCod(student, 'book-1');
  const oid = placed.body?.data?._id as string;

  let cur = (await getOrder(student, oid)).body.data;
  check(cur.status === 'pending' && !cur.confirmedAt, 'fresh COD order: pending, no confirmedAt');
  check(printedIndex(cur) === 0, 'BEFORE admin confirms → step 1 "Order placed" (this is the client\'s complaint fixed)');

  await setStatus(admin, oid, 'processing');
  cur = (await getOrder(student, oid)).body.data;
  check(!!cur.confirmedAt && printedIndex(cur) === 1, 'AFTER admin confirms → step 2 "Order confirmed"');

  await setStatus(admin, oid, 'shipped');
  cur = (await getOrder(student, oid)).body.data;
  check(!!cur.shippedAt && printedIndex(cur) === 2, 'after shipped → step 3 "Shipped"');

  await setStatus(admin, oid, 'delivered');
  cur = (await getOrder(student, oid)).body.data;
  check(!!cur.deliveredAt && printedIndex(cur) === 3, 'after delivered → step 4 "Delivered"');
  check(cur.payment?.status === 'paid', 'COD delivered → payment recorded as paid');

  console.log(`\n──────── RESULT: ${passed} passed, ${failed} failed ────────`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('TEST CRASHED:', e);
  process.exit(1);
});
