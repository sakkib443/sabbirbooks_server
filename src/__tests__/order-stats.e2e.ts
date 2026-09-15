/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * The dashboard's order money, with and without the delivery charge
 * (isolated in-memory MongoDB, real Express app via supertest; never the live DB).
 *
 * An order's total is its books (after offers and coupons) plus the delivery
 * charge. The shop wants its book sales without the courier's money in them,
 * how much delivery came in, and how many books were sold — per title too.
 *
 * Run:  npx ts-node --transpile-only src/__tests__/order-stats.e2e.ts
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

  const anatomy = new mongoose.Types.ObjectId();
  const physiology = new mongoose.Types.ObjectId();
  const line = (book: mongoose.Types.ObjectId, title: string, price: number, quantity: number) => ({
    book, title, price, quantity, format: 'printed',
  });
  const ship = { name: 'R', phone: '01711111111', address: 'Hall', city: 'শাহবাগ' };
  const order = (o: Record<string, unknown>) =>
    Order.create({ deliveryType: 'printed', shippingAddress: ship, ...o } as any);

  // A — two copies, delivered on COD: earned, with a ৳120 delivery charge.
  await order({
    items: [line(anatomy, 'MAGIC VIVA ANATOMY', 650, 2)],
    subtotal: 1300, discount: 160, deliveryCharge: 120, total: 1260,
    status: 'delivered', payment: { method: 'cod', status: 'paid' },
  });
  // B — two titles, paid online, free delivery: earned, no delivery charge.
  await order({
    items: [line(anatomy, 'MAGIC VIVA ANATOMY', 650, 1), line(physiology, 'MAGIC VIVA PHYSIOLOGY', 300, 1)],
    subtotal: 950, discount: 95, deliveryCharge: 0, total: 855,
    status: 'processing', payment: { method: 'sslcommerz', status: 'paid' },
  });
  // C — three copies on COD, not delivered yet: upcoming, with ৳130 delivery.
  await order({
    items: [line(physiology, 'MAGIC VIVA PHYSIOLOGY', 300, 3)],
    subtotal: 900, discount: 0, deliveryCharge: 130, total: 1030,
    status: 'pending', payment: { method: 'cod', status: 'pending' },
  });
  // D — cancelled: in no figure at all.
  await order({
    items: [line(anatomy, 'MAGIC VIVA ANATOMY', 650, 5)],
    subtotal: 3250, discount: 0, deliveryCharge: 120, total: 3370,
    status: 'cancelled', payment: { method: 'cod', status: 'pending' },
  });
  // E — an order from before the delivery field existed: counts as no charge.
  const legacy = await order({
    items: [line(anatomy, 'MAGIC VIVA ANATOMY', 650, 1)],
    subtotal: 650, discount: 0, total: 650,
    status: 'delivered', payment: { method: 'cod', status: 'paid' },
  });
  await Order.collection.updateOne({ _id: legacy._id }, { $unset: { deliveryCharge: '' } });

  await api().post('/api/auth/register').send({
    firstName: 'A', lastName: 'B', email: 'admin@t.com', password: 'pass1234', whatsappNumber: '01712345678',
  });
  await User.updateOne({ email: 'admin@t.com' }, { status: 'active', role: 'admin' });
  const token = (
    await api().post('/api/auth/login').set('x-device-id', 'dev-admin').send({ email: 'admin@t.com', password: 'pass1234' })
  ).body?.data?.accessToken;

  const res = await api().get('/api/orders/stats').set('Authorization', `Bearer ${token}`);
  const s = res.body?.data;

  console.log('\n── All time ──');
  {
    const t = s?.totals;
    check(res.status === 200, `stats load (${res.status})`, res.body?.message);
    check(t?.orders === 4, `4 live orders — the cancelled one is out (${t?.orders})`);
    check(t?.copies === 8, `8 books: 2 + (1 + 1) + 3 + 1 (${t?.copies})`);
    check(t?.value === 3795 && t?.earned === 2765 && t?.upcoming === 1030, 'with delivery: value 3795, earned 2765, upcoming 1030 — unchanged', t);
    check(t?.delivery?.value === 250 && t?.delivery?.earned === 120 && t?.delivery?.upcoming === 130, 'delivery charge: 250 in all, 120 collected, 130 to come', t?.delivery);
    check(t?.books?.value === 3545 && t?.books?.earned === 2645 && t?.books?.upcoming === 900, 'books alone: 3545 sold, 2645 earned, 900 to come', t?.books);
  }

  console.log('\n── The date range, day by day ──');
  {
    const r = s?.range;
    check(r?.copies === 8 && r?.books?.value === 3545 && r?.delivery?.value === 250, 'this month carries the same split', { copies: r?.copies, books: r?.books, delivery: r?.delivery });
    const day = (r?.daily || []).find((d: any) => d.orders > 0);
    check(!!day && day.copies === 8 && day.delivery === 250 && day.earnedDelivery === 120, "today's chart row has copies and delivery for the no-delivery line", day);
  }

  console.log('\n── Breakdowns ──');
  {
    const cod = s?.byMethod?.cod;
    check(cod?.orders === 3 && cod?.value === 2940 && cod?.delivery === 250 && cod?.copies === 6, 'by method: COD 3 orders, 2940 with 250 delivery, 6 books', cod);
    const cancelled = s?.byStatus?.cancelled;
    check(cancelled?.copies === 5 && cancelled?.delivery === 120, 'by status keeps the cancelled row, with its split', cancelled);

    const byBook = s?.byBook || [];
    const a = byBook.find((b: any) => b.title === 'MAGIC VIVA ANATOMY');
    const p = byBook.find((b: any) => b.title === 'MAGIC VIVA PHYSIOLOGY');
    // Anatomy: order A 1140 + B's share 855 × 650/950 = 585 + legacy 650 = 2375.
    check(a?.copies === 4 && a?.orders === 3 && a?.sales === 2375, 'Anatomy: 4 copies in 3 orders, ৳2375 of book sales', a);
    // Physiology: B's share 855 × 300/950 = 270 + order C 900 = 1170.
    check(p?.copies === 4 && p?.orders === 2 && p?.sales === 1170, 'Physiology: 4 copies in 2 orders, ৳1170', p);
    check(byBook.reduce((sum: number, b: any) => sum + b.sales, 0) === s?.range?.books?.value, 'the titles add up to the book sales');
    check(!byBook.some((b: any) => b.copies >= 9), 'the cancelled order adds no copies to a title');
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
