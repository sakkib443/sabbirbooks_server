/* eslint-disable no-console */
/**
 * Admin = the last 15 days; superAdmin = everything.
 *
 * One recent order and one placed 20 days ago. Every screen that counts orders
 * or money is asked by both roles: the admin must see only the recent one, the
 * superAdmin both — and the admin must not reach the old one by its id either.
 * Plus: only a superAdmin hands out admin or superAdmin accounts.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

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
  check(la.body?.data?.length === 1 && la.body.data[0]._id === recent._id, 'admin lists only the recent order', la.body?.data?.length);
  check(ls.body?.data?.length === 2, 'superAdmin lists both', ls.body?.data?.length);
  const askOld = await api().get(`/api/orders?from=${new Date(Date.now() - 30 * 86400_000).toISOString()}&to=${new Date(Date.now() - 18 * 86400_000).toISOString()}`).set(A);
  check((askOld.body?.data?.length ?? 0) === 0, 'admin asking for 30–18 days ago gets nothing', askOld.body?.data?.length);

  console.log('── One order by id ──');
  check((await api().get(`/api/orders/${old._id}`).set(A)).status === 403, 'admin cannot open the old order by id');
  check((await api().get(`/api/orders/${recent._id}`).set(A)).status === 200, 'admin can open the recent one');
  check((await api().get(`/api/orders/${old._id}`).set(S)).status === 200, 'superAdmin can open the old one');
  check((await api().patch(`/api/orders/${old._id}/status`).set(A).send({ status: 'cancelled' })).status === 403, 'admin cannot change the old order');
  check((await api().delete(`/api/orders/${old._id}`).set(A)).status === 403, 'admin cannot delete the old order');

  console.log('── Dashboard ──');
  const sa = (await api().get('/api/orders/stats').set(A)).body?.data;
  const ss = (await api().get('/api/orders/stats').set(S)).body?.data;
  check(sa?.totals?.orders === 1, 'admin dashboard totals: 1 order', sa?.totals);
  check(ss?.totals?.orders === 2, 'superAdmin dashboard totals: 2 orders', ss?.totals);
  check(sa?.totals?.value > 0, 'admin still sees money (not money-blind)', sa?.totals?.value);

  console.log('── Coupon payouts ──');
  const pa = (await api().get('/api/book-coupons/payouts').set(A)).body?.data;
  const ps = (await api().get('/api/book-coupons/payouts').set(S)).body?.data;
  const rowA = (pa?.rows || pa || []).find?.((r: any) => r.code === 'SAVE');
  const rowS = (ps?.rows || ps || []).find?.((r: any) => r.code === 'SAVE');
  check(rowA?.sales === 1 && rowS?.sales === 2, 'coupon sales: admin 1, superAdmin 2', { a: rowA?.sales, s: rowS?.sales });

  console.log('── Courier ──');
  const ca = (await api().get('/api/courier/summary').set(A)).body?.data;
  const cs = (await api().get('/api/courier/summary').set(S)).body?.data;
  check(ca?.parcels === 1 && cs?.parcels === 2, 'courier parcels: admin 1, superAdmin 2', { a: ca?.parcels, s: cs?.parcels });
  const cla = (await api().get('/api/courier/consignments').set(A)).body?.data;
  check(cla?.total === 1, 'courier list: admin sees 1', cla?.total);

  console.log('── Who may create whom ──');
  const staff = (role: string) => ({ firstName: 'N', email: `${role}-${Date.now()}@test.com`, password: 'pass1234', role });
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
