/* eslint-disable no-console */
/**
 * Admin = every order, each order's own money, but never a sum (18 Oct 2026);
 * superAdmin = everything.
 *
 * One recent order and one placed 20 days ago. Every screen that counts orders
 * or money is asked by both roles: both see both orders; only the superAdmin
 * sees a taka of them.
 * Plus: only a superAdmin hands out admin or superAdmin accounts.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { approveDevice } from './_approveDevice';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`, detail ?? '');
  }
}

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
  const { Book } = await import('../app/modules/book/book.model');
  const { User } = await import('../app/modules/user/user.model');
  const api = () => request(app);

  await Book.create({ id: 1, title: 'Anatomy', slug: 'book-1', price: 500, format: 'printed', stock: 100 });

  const registerLogin = async (email: string, device: string, role?: string) => {
    await api().post('/api/auth/register').send({ firstName: 'T', lastName: 'U', email, password: 'pass1234', whatsappNumber: '01712345678' });
    await User.updateOne({ email }, { ...(role ? { role } : {}), medicalCollegeName: 'Khulna Medical College' });
    await approveDevice(email, device);
    const res = await api().post('/api/auth/login').set('x-device-id', device).send({ email, password: 'pass1234' });
    return res.body?.data?.accessToken as string;
  };
  const buyer = await registerLogin('buyer@test.com', 'b1');
  const admin = await registerLogin('admin@test.com', 'a1', 'admin');
  const sup = await registerLogin('owner@test.com', 's1', 'superAdmin');
  const A = { Authorization: `Bearer ${admin}` };
  const S = { Authorization: `Bearer ${sup}` };

  const place = async () =>
    (
      await api()
        .post('/api/orders')
        .set('Authorization', `Bearer ${buyer}`)
        .send({
          items: [{ bookSlugOrId: 'book-1', quantity: 1 }],
          shippingAddress: { name: 'R', phone: '01711111111', address: 'Hall', city: 'Sonadanga', district: 'Khulna' },
          paymentMethod: 'cod',
        })
    ).body?.data;

  const recent = await place();
  const old = await place();
  const twentyDaysAgo = new Date(Date.now() - 20 * 86400_000);
  // Both used a coupon and both went to the courier, so every screen has
  // something to count.
  const courier = (sentAt: Date, id: string) => ({
    provider: 'steadfast', consignmentId: id, trackingCode: `T${id}`, status: 'delivered',
    codAmount: 620, collectedAmount: 620, deliveryCharge: 110, sentAt, paymentId: null,
  });
  await Order.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(old._id) }, {
    $set: { createdAt: twentyDaysAgo, couponCode: 'SAVE', couponPayout: 30, courier: courier(twentyDaysAgo, '1') },
  });
  await Order.collection.updateOne({ _id: new (require('mongoose').Types.ObjectId)(recent._id) }, {
    $set: { couponCode: 'SAVE', couponPayout: 30, courier: courier(new Date(), '2') },
  });
  const { BookCoupon } = await import('../app/modules/bookCoupon/bookCoupon.model');
  await BookCoupon.create({ code: 'SAVE', discountType: 'fixed', discountValue: 20, payoutPerSale: 30 });

  console.log('── Order list ──');
  const la = await api().get('/api/orders?limit=50').set(A);
  const ls = await api().get('/api/orders?limit=50').set(S);
  check(la.body?.data?.length === 2, 'admin lists every order (no date limit)', la.body?.data?.length);
  check(ls.body?.data?.length === 2, 'superAdmin lists both', ls.body?.data?.length);
  const rowA = la.body?.data?.[0] || {};
  const rowS = ls.body?.data?.[0] || {};
  check(typeof rowA.total === 'number' && typeof rowA.subtotal === 'number', 'admin sees the money of each order', rowA);
  check(typeof rowA.courier?.codAmount === 'number', 'admin sees the COD of a parcel', rowA.courier);
  check(typeof rowS.total === 'number' && typeof rowS.subtotal === 'number', 'superAdmin rows carry the money');

  console.log('── One order by id ──');
  const oneA = await api().get(`/api/orders/${old._id}`).set(A);
  check(oneA.status === 200, 'admin can open the old order');
  check(typeof oneA.body?.data?.total === 'number', 'admin: one order shows its money', oneA.body?.data?.total);
  check(typeof (await api().get(`/api/orders/${old._id}`).set(S)).body?.data?.total === 'number', 'superAdmin sees its money');
  check((await api().delete(`/api/orders/${recent._id}`).set(A)).status === 403, 'admin cannot delete an order (Super Admin only)');
  check((await api().post('/api/orders/bulk-delete').set(A).send({ ids: [recent._id] })).status === 403, 'admin cannot bulk-delete either');
  const changed = await api().patch(`/api/orders/${recent._id}/status`).set(A).send({ status: 'processing' });
  check(changed.status === 200, 'admin can work an order', changed.status);

  console.log('── Dashboard ──');
  const sa = (await api().get('/api/orders/stats').set(A)).body?.data;
  const ss = (await api().get('/api/orders/stats').set(S)).body?.data;
  check(sa && Object.keys(sa).join() === 'newOrders', 'admin dashboard: only the new-order count, no totals', sa);
  check(ss?.totals?.orders === 2, 'superAdmin dashboard totals: 2 orders', ss?.totals);
  check(ss?.totals?.value > 0, 'superAdmin dashboard: the money', ss?.totals?.value);

  console.log('── Coupon payouts ──');
  const pa = await api().get('/api/book-coupons/payouts').set(A);
  const payA = (pa.body?.data?.rows || []).find((r: any) => r.code === 'SAVE');
  check(pa.status === 200 && payA?.totalPayout > 0, 'admin sees what each coupon owner is owed', payA);
  check(pa.body?.data?.totals === null && payA?.revenue === undefined, '…but no grand totals or sales value', pa.body?.data?.totals);
  const ps = (await api().get('/api/book-coupons/payouts').set(S)).body?.data;
  const payS = (ps?.rows || ps || []).find?.((r: any) => r.code === 'SAVE');
  check(payS?.sales === 2, 'superAdmin coupon sales: 2', payS?.sales);

  console.log('── Courier ──');
  const caRes = await api().get('/api/courier/summary').set(A);
  const cs = (await api().get('/api/courier/summary').set(S)).body?.data;
  check(caRes.status === 403, 'courier money summary is Super Admin only', caRes.status);
  check((await api().get('/api/courier/payments').set(A)).status === 403, 'courier payouts list is Super Admin only');
  check((await api().post('/api/courier/payments/sync').set(A)).status === 403, 'courier payout sync is Super Admin only');
  check(cs?.parcels === 2, 'superAdmin courier summary: 2 parcels', cs?.parcels);
  const cla = (await api().get('/api/courier/consignments').set(A)).body?.data;
  check(cla?.total === 2, 'courier list: admin sees both parcels', cla?.total);
  const parcelA = cla?.rows?.[0] || {};
  check(typeof parcelA.courier?.codAmount === 'number', 'courier list: admin sees the COD of each parcel', parcelA.courier);
  check((await api().get('/api/courier/status').set(A)).body?.data?.balance == null, 'courier balance (a total) is not sent to the admin');

  console.log('── Who may create whom ──');
  const staff = (role: string) => ({ firstName: 'N', email: `${role}-${Date.now()}@test.com`, password: 'pass1234', role });
  check((await api().post('/api/user/create-staff').set(A).send(staff('manager'))).status === 403, 'admin cannot create even a manager (Super Admin only)');
  check((await api().post('/api/user/create-staff').set(A).send(staff('admin'))).status === 403, 'admin cannot create an admin');
  check((await api().post('/api/user/create-staff').set(A).send(staff('superAdmin'))).status === 403, 'admin cannot create a superAdmin');
  check((await api().post('/api/user/create-staff').set(S).send(staff('admin'))).status === 201, 'superAdmin creates an admin');
  check((await api().post('/api/user/create-staff').set(S).send(staff('superAdmin'))).status === 201, 'superAdmin creates a superAdmin');
  const adminDoc: any = await User.findOne({ email: 'admin@test.com' }).lean();
  const selfPromote = await api().patch(`/api/user/${adminDoc._id}`).set(A).send({ role: 'superAdmin' });
  check(selfPromote.status >= 400, 'admin cannot promote themselves', selfPromote.status);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
