/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * 22–23 Oct 2026 shop requests:
 *   • "Returned": an admin can set it; Steadfast's "cancelled" sets it by itself;
 *     the books go back in stock; a returned parcel is not a sale;
 *   • the "Paid" status filter finds paid orders whatever their status now is;
 *   • "without delivery" money always takes at least ৳120 off a printed order,
 *     even when the buyer got delivery free.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { approveDevice } from './_approveDevice';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); } else { failed++; console.log(`  ❌ ${msg}`, detail ?? ''); }
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.SMS_API_KEY = '';
  process.env.SMS_USERNAME = '';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { User } = await import('../app/modules/user/user.model');
  const { Book } = await import('../app/modules/book/book.model');
  const { Order } = await import('../app/modules/order/order.model');
  const { OrderService } = await import('../app/modules/order/order.service');
  const { ManualOrderService } = await import('../app/modules/order/manualOrder.service');
  const api = () => request(app);

  const book: any = await Book.create({ id: 1, title: 'MAGIC VIVA ANATOMY', slug: 'anatomy', price: 650, format: 'printed', stock: 100 });
  const make = async (email: string, role: string) => {
    await api().post('/api/auth/register').send({ firstName: role, lastName: 'T', email, password: 'pass1234', whatsappNumber: '01712345678' });
    await User.updateOne({ email }, { role, status: 'active' });
    await approveDevice(email, `d-${email}`);
    const r = await api().post('/api/auth/login').set('x-device-id', `d-${email}`).send({ email, password: 'pass1234' });
    return { Authorization: `Bearer ${r.body?.data?.accessToken}` };
  };
  const S = await make('owner@t.com', 'superAdmin');

  const add = async (rows: any[]) => (await ManualOrderService.addOrders(rows, { source: 'manual' })).results.map((r) => r.orderId);
  // A: confirmed COD ৳770 incl ৳120 delivery. B: paid, shipped, free delivery (৳650 total).
  const [a, b] = await add([
    { name: 'A', phone: '01711000001', address: 'x', quantity: '1', amount: '770', deliveryCharge: '120', status: 'confirmed', payment: 'cod' },
    { name: 'B', phone: '01711000002', address: 'x', quantity: '1', amount: '650', deliveryCharge: '0', status: 'shipped', payment: 'paid' },
  ]);

  console.log('── Paid filter ──');
  const paid = await api().get('/api/orders').set(S).query({ status: 'paid', limit: 50 });
  const list = paid.body?.data?.orders || paid.body?.data || [];
  check(Array.isArray(list) && list.length === 1 && String(list[0]._id) === b, 'Paid finds the paid (shipped) order', paid.body?.data);

  console.log('── Delivery ৳120 ──');
  const stats = await OrderService.getBookOrderStats({});
  const t: any = (stats as any).totals || (stats as any).allTime || stats;
  const deliveryTotal = t?.delivery?.value;
  check(Number(deliveryTotal) === 240, 'free-delivery order still counts ৳120 delivery (120 + 120)', { deliveryTotal, t });

  console.log('── Returned ──');
  const before = ((await Book.findById(book._id).lean()) as any).stock;
  const r = await api().patch(`/api/orders/${a}/status`).set(S).send({ status: 'returned' });
  check(r.status === 200 && r.body?.data?.status === 'returned', 'admin can mark returned', r.body);
  const after = ((await Book.findById(book._id).lean()) as any).stock;
  check(after === before + 1, 'the book is back in stock', [before, after]);
  const oa: any = await Order.findById(a).lean();
  check(!!oa.returnedAt && oa.payment.status === 'failed', 'returnedAt stamped; unpaid COD marked failed');
  const stats2 = JSON.stringify(await OrderService.getBookOrderStats({}));
  check(stats2.match(/"orders":(\d+)/)?.[1] === '1', 'a returned parcel is not counted as a sale', stats2.slice(0, 200));

  // Steadfast says "cancelled" → returned by itself.
  await Order.updateOne({ _id: b }, { $set: { courier: { provider: 'steadfast', consignmentId: 'C1', trackingCode: 'T1', status: 'in_review' } } });
  const { CourierService } = await import('../app/modules/courier/courier.service');
  const rec: any = await (CourierService as any).applyStatus?.(b, 'cancelled', { message: 'returned to merchant' });
  void rec;
  let ob: any = await Order.findById(b).lean();
  if (ob.status !== 'returned') {
    // applyStatus may not be exported; the reconcile pass does the same.
    await Order.updateOne({ _id: b }, { $set: { 'courier.status': 'cancelled' } });
    await (CourierService as any).reconcileOrders();
    ob = await Order.findById(b).lean();
  }
  check(ob.status === 'returned', 'courier "cancelled" → order Returned by itself', ob.status);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
