/* eslint-disable no-console */
/**
 * Orders added by hand or from a sheet (manualOrder.service):
 *   • a dry run checks every row and saves nothing; bad rows say why;
 *   • the good rows become orders with the sheet's status, price and date,
 *     stock taken for confirmed/shipped/delivered, no text sent;
 *   • the same sheet uploaded again adds nothing twice (externalRef);
 *   • "send SMS" ticked: each buyer gets the text for their status; and the
 *     same tick on a status change (confirm / shipped / delivered);
 *   • stock always comes off on delivery;
 *   • only an admin may do it.
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
  // Empty, not deleted: dotenv would fill a deleted key from .env, and this
  // test must never text a real number. Empty = the gateway's demo mode.
  process.env.SMS_API_KEY = '';
  process.env.SMS_USERNAME = '';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { User } = await import('../app/modules/user/user.model');
  const { Book } = await import('../app/modules/book/book.model');
  const { Order } = await import('../app/modules/order/order.model');
  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const api = () => request(app);

  const book: any = await Book.create({ id: 1, title: 'MAGIC VIVA ANATOMY', slug: 'anatomy', price: 650, offerPrice: 600, format: 'printed', stock: 100 });
  await MedicalCollege.create({ name: 'Khulna Medical College', searchKey: 'khulna medical college', type: 'government', abbreviation: 'KMC', district: 'খুলনা', upazila: 'খুলনা সদর', division: 'খুলনা', isActive: true });

  const make = async (email: string, role: string) => {
    await api().post('/api/auth/register').send({ firstName: role, lastName: 'T', email, password: 'pass1234', whatsappNumber: '01712345678' });
    await User.updateOne({ email }, { role, status: 'active' });
    await approveDevice(email, `d-${email}`);
    const r = await api().post('/api/auth/login').set('x-device-id', `d-${email}`).send({ email, password: 'pass1234' });
    return { Authorization: `Bearer ${r.body?.data?.accessToken}` };
  };
  const A = await make('admin@t.com', 'admin');
  const M = await make('manager@t.com', 'manager');

  const sheet = [
    { ref: 'KMC-01', date: '18/10/2026', name: 'Rahim', phone: '01711 111 111', college: 'KMC', quantity: '2', amount: '1320', deliveryCharge: '120', payment: 'cod', status: 'confirmed' },
    { ref: 'KMC-02', name: 'Karim', phone: '+8801722222222', college: 'Khulna Medical College', book: 'anatomy', status: 'shipped', payment: 'paid' },
    { ref: 'KMC-03', name: 'Sumi', phone: '০১৭৩৩৩৩৩৩৩৩', address: 'Hall 2, Room 5', district: 'ঢাকা', quantity: '১', status: 'delivered' },
    { ref: 'BAD-1', name: '', phone: '01744444444', college: 'KMC' },
    { ref: 'BAD-2', name: 'X', phone: '12345', college: 'KMC' },
    { ref: 'BAD-3', name: 'Y', phone: '01755555555' },
    { ref: 'BAD-4', name: 'Z', phone: '01766666666', college: 'KMC', status: 'maybe' },
    { ref: 'KMC-01', name: 'Dup', phone: '01777777777', college: 'KMC' },
  ];

  console.log('── Dry run ──');
  const dry = await api().post('/api/orders/manual').set(A).send({ orders: sheet, dryRun: true, source: 'import' });
  const res = dry.body?.data?.results || [];
  check(dry.status === 200 && res.length === 8, 'every row answered', dry.body);
  check(res.filter((r: any) => r.ok).length === 3, 'three good rows', res.map((r: any) => r.error || 'ok'));
  check(/নাম/.test(res[3]?.error) && /মোবাইল/.test(res[4]?.error) && /ঠিকানা/.test(res[5]?.error) && /স্ট্যাটাস/.test(res[6]?.error), 'each bad row says why', res.slice(3, 7));
  check(/আগেই/.test(res[7]?.error), 'a ref repeated inside the sheet is refused', res[7]);
  check(res[0]?.preview?.total === 1320 && res[1]?.preview?.total === 600, 'amount from the sheet, else the book price', [res[0]?.preview, res[1]?.preview]);
  check((await Order.countDocuments()) === 0, 'a dry run saves nothing');

  console.log('── Import ──');
  const imp = await api().post('/api/orders/manual').set(A).send({ orders: sheet, source: 'import' });
  check(imp.body?.data?.created === 3 && imp.body?.data?.failed === 5, 'three created, five refused', imp.body?.data);
  const o1: any = await Order.findOne({ externalRef: 'KMC-01' }).lean();
  check(o1?.status === 'processing' && o1?.total === 1320 && o1?.deliveryCharge === 120 && o1?.items?.[0]?.quantity === 2, 'confirmed, ৳1320 with ৳120 delivery, 2 copies', o1);
  check(o1?.college?.name === 'Khulna Medical College' && o1?.shippingAddress?.district === 'খুলনা', 'college matched by abbreviation, its district filled in', o1?.college);
  check(new Date(o1.createdAt).toISOString() === '2026-10-18T04:00:00.000Z', 'the sheet date is the order date', o1?.createdAt);
  check(o1?.source === 'import' && typeof o1?.orderSeq === 'number', 'marked imported, numbered like any order');
  const o2: any = await Order.findOne({ externalRef: 'KMC-02' }).lean();
  check(o2?.status === 'shipped' && o2?.payment?.status === 'paid' && o2?.payment?.method === 'manual', 'shipped and paid', o2?.payment);
  const o3: any = await Order.findOne({ externalRef: 'KMC-03' }).lean();
  check(o3?.status === 'delivered' && o3?.payment?.status === 'paid' && o3?.shippingAddress?.phone === '01733333333', 'delivered COD counts as paid; Bengali digits read', o3);
  const b: any = await Book.findById(book._id).lean();
  check(b.stock === 96, 'stock taken for the 4 copies', b.stock);

  console.log('── Again ──');
  const again = await api().post('/api/orders/manual').set(A).send({ orders: sheet.slice(0, 3), source: 'import' });
  check(again.body?.data?.created === 0 && (await Order.countDocuments()) === 3, 'the same sheet again adds nothing');

  console.log('── One by hand ──');
  const one = await api().post('/api/orders/manual').set(A).send({ orders: [{ name: 'Walk-in', phone: '01788888888', college: 'KMC', status: 'pending' }] });
  check(one.body?.data?.created === 1 && one.body?.data?.results?.[0]?.orderSeq, 'the form adds one order', one.body?.data);
  check((await Order.findOne({ 'shippingAddress.name': 'Walk-in' }).lean() as any)?.source === 'manual', 'marked manual');

  console.log('── SMS ──');
  const wait = () => new Promise((r) => setTimeout(r, 300));
  await wait();
  const sentOf = async (q: any) => [...(((await Order.findOne(q).lean()) as any)?.smsSent || [])].sort().join(',');
  check((await sentOf({ externalRef: 'KMC-01' })) === '' && (await sentOf({ externalRef: 'KMC-03' })) === '', 'no tick: nobody texted');
  const smsSheet = [
    { ref: 'S-1', name: 'A', phone: '01711000001', college: 'KMC', status: 'confirmed', payment: 'cod' },
    { ref: 'S-2', name: 'B', phone: '01711000002', college: 'KMC', status: 'shipped' },
    { ref: 'S-3', name: 'C', phone: '01711000003', college: 'KMC', status: 'delivered' },
    { ref: 'S-4', name: 'D', phone: '01711000004', college: 'KMC', status: 'pending' },
  ];
  const withSms = await api().post('/api/orders/manual').set(A).send({ orders: smsSheet, source: 'import', sms: true });
  check(withSms.body?.data?.created === 4, 'four added with the SMS tick', withSms.body?.data);
  await wait();
  check((await sentOf({ externalRef: 'S-1' })) === 'placed', 'confirmed COD → the confirm text');
  check((await sentOf({ externalRef: 'S-2' })) === 'shipped', 'shipped → the shipped text');
  check((await sentOf({ externalRef: 'S-3' })) === 'delivered', 'delivered → the delivered text');
  check((await sentOf({ externalRef: 'S-4' })) === '', 'pending → nothing');

  console.log('── Status change ──');
  const p: any = await Order.findOne({ externalRef: 'S-4' });
  const stockBefore = ((await Book.findById(book._id).lean()) as any).stock;
  const st = (body: any) => api().patch(`/api/orders/${p._id}/status`).set(A).send(body);
  check((await st({ status: 'processing' })).status === 200, 'confirm without the tick');
  await wait();
  check((await sentOf({ _id: p._id })) === '', 'no tick on confirm: no text');
  await st({ status: 'shipped', sms: false });
  await wait();
  check((await sentOf({ _id: p._id })) === '', 'shipped with the tick off: no text');
  await st({ status: 'delivered', sms: true });
  await wait();
  check((await sentOf({ _id: p._id })) === 'delivered', 'delivered with the tick: the delivered text');
  const stockAfter = ((await Book.findById(book._id).lean()) as any).stock;
  check(stockAfter === stockBefore - 1, 'stock came off once for the one copy', [stockBefore, stockAfter]);

  const q: any = await Order.findOne({ externalRef: 'KMC-01' });
  await api().patch(`/api/orders/${q._id}/status`).set(A).send({ status: 'delivered' });
  await wait();
  check(!(await sentOf({ _id: q._id })).includes('delivered'), 'delivered without the tick: no text (the shop rule)');

  const r1: any = await Order.create({
    user: null, orderNumber: 'T-1', items: [{ book: book._id, title: 'x', quantity: 1, price: 600 }],
    subtotal: 600, total: 600, status: 'pending', payment: { method: 'cod', status: 'pending' },
    shippingAddress: { name: 'E', phone: '01711000005', address: 'x', district: 'ঢাকা' },
  }).catch(() => null);
  if (r1) {
    const before = ((await Book.findById(book._id).lean()) as any).stock;
    await api().patch(`/api/orders/${r1._id}/status`).set(A).send({ status: 'delivered' });
    const after = ((await Book.findById(book._id).lean()) as any).stock;
    check(after === before - 1, 'pending straight to delivered: stock still comes off', [before, after]);
  }
  const bulk = await api().patch('/api/orders/bulk-status').set(A).send({ ids: [String(r1?._id || p._id)], status: 'shipped', sms: true });
  check(bulk.status === 200, 'bulk status takes the sms flag', bulk.body);

  console.log('── Who ──');
  check((await api().post('/api/orders/manual').set(M).send({ orders: sheet.slice(0, 1) })).status === 403, 'a manager cannot add orders');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
