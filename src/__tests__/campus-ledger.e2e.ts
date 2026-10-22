/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Campus orders (campus module) and the Accounts page (ledger module):
 *   • the seniors' phone book lists every college with its contacts;
 *   • a deal's total is worked out on the server (price − extra discount,
 *     free delivery, free copies cost nothing);
 *   • "make the order" creates one real Order: all copies incl. the free ones,
 *     the deal's total, stock taken, on the ship day; twice is refused;
 *   • money fields lock once the order exists; a placed deal cannot be deleted;
 *   • the ledger: sales per shop day from orders + hand-typed income/expense;
 *   • who: admin runs campus, a manager does not; the ledger is the Super Admin's.
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
  process.env.SMS_API_KEY = '';
  process.env.SMS_USERNAME = '';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { User } = await import('../app/modules/user/user.model');
  const { Book } = await import('../app/modules/book/book.model');
  const { Order } = await import('../app/modules/order/order.model');
  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const { shopDayOf } = await import('../app/utils/shopDay');
  const api = () => request(app);

  const book: any = await Book.create({ id: 1, title: 'MAGIC VIVA ANATOMY', slug: 'anatomy', price: 650, offerPrice: 600, format: 'printed', stock: 100 });
  const kmc: any = await MedicalCollege.create({ name: 'Khulna Medical College', searchKey: 'khulna medical college', type: 'government', abbreviation: 'KMC', district: 'খুলনা', upazila: 'খুলনা সদর', division: 'খুলনা', isActive: true });
  await MedicalCollege.create({ name: 'Dhaka Medical College', searchKey: 'dhaka medical college', type: 'government', abbreviation: 'DMC', district: 'ঢাকা', upazila: 'শাহবাগ', division: 'ঢাকা', isActive: true });

  const make = async (email: string, role: string) => {
    await api().post('/api/auth/register').send({ firstName: role, lastName: 'T', email, password: 'pass1234', whatsappNumber: '01712345678' });
    await User.updateOne({ email }, { role, status: 'active' });
    await approveDevice(email, `d-${email}`);
    const r = await api().post('/api/auth/login').set('x-device-id', `d-${email}`).send({ email, password: 'pass1234' });
    return { Authorization: `Bearer ${r.body?.data?.accessToken}` };
  };
  const S = await make('owner@t.com', 'superAdmin');
  const A = await make('admin@t.com', 'admin');
  const M = await make('manager@t.com', 'manager');

  console.log('── Phone book ──');
  const c1 = await api().post('/api/campus/contacts').set(A).send({ college: String(kmc._id), name: 'Rafi (senior)', phone: '01711000000', batch: 'K-60' });
  check(c1.status === 200 && c1.body?.data?.role === 'senior', 'admin adds a senior', c1.body);
  const c2 = await api().post('/api/campus/contacts').set(A).send({ college: String(kmc._id), name: 'Nila', role: 'student', note: 'সিনিয়র নেয় না' });
  check(c2.body?.data?.role === 'student', 'and an ordinary student with a note');
  const dir = await api().get('/api/campus/contacts').set(A);
  const k = (dir.body?.data || []).find((c: any) => c.name === 'Khulna Medical College');
  check(dir.body?.data?.length === 2 && k?.contacts?.length === 2, 'every college listed, with its contacts', dir.body?.data);
  const ed = await api().patch(`/api/campus/contacts/${c1.body.data._id}`).set(A).send({ phone: '01722000000' });
  check(ed.body?.data?.phone === '01722000000', 'a contact can be edited');

  console.log('── Deal ──');
  const deal = await api().post('/api/campus/orders').set(A).send({
    college: String(kmc._id), contact: { name: 'Rafi', phone: '01722000000', role: 'senior' }, batch: 'K-60',
    quantity: 12, extraDiscount: 50, giftAbove: 10, freeBooks: 1, freeDelivery: true, deliveryCharge: 120,
    contactedOn: '2026-10-15', deadline: '2026-10-22', shipOn: '2026-10-24', total: 1,
  });
  const d = deal.body?.data;
  check(deal.status === 200 && d?.unitPrice === 600 && d?.bookTitle === 'MAGIC VIVA ANATOMY', 'book and its price filled in', deal.body);
  check(d?.total === 12 * 550, 'total = 12 × (600 − 50), delivery free — the server works it out', d?.total);
  check(d?.district === 'খুলনা', 'the college fills in the district');
  const ch = await api().patch(`/api/campus/orders/${d._id}`).set(A).send({ freeDelivery: false });
  check(ch.body?.data?.total === 12 * 550 + 120, 'delivery not free → charge added', ch.body?.data?.total);
  const bad = await api().post('/api/campus/orders').set(A).send({ college: String(kmc._id), contact: { name: 'X' }, extraDiscount: 9999 });
  check(bad.status === 400, 'a discount above the price is refused', bad.body);
  check((await api().get('/api/campus/orders').set(M)).status === 403, 'a manager cannot see campus deals');

  console.log('── Make the order ──');
  const stockBefore = ((await Book.findById(book._id).lean()) as any).stock;
  const pl = await api().post(`/api/campus/orders/${d._id}/place`).set(A).send({});
  const placed = pl.body?.data;
  check(pl.status === 200 && placed?.status === 'ready' && placed?.order?.orderSeq, 'the order is made', pl.body);
  const o: any = await Order.findById(placed?.order?._id).lean();
  check(o?.items?.[0]?.quantity === 13 && o?.total === 12 * 550 + 120 && o?.deliveryCharge === 120, '13 copies (12 + 1 free), the deal total', o);
  check(o?.source === 'campus' && o?.status === 'processing' && o?.college?.name === 'Khulna Medical College', 'marked campus, confirmed, at the college');
  check(shopDayOf(new Date(o?.dispatchDate)) === '2026-10-24', 'on the ship day\'s list', o?.dispatchDate);
  const stockAfter = ((await Book.findById(book._id).lean()) as any).stock;
  check(stockAfter === stockBefore - 13, 'stock down 13, free copy included', [stockBefore, stockAfter]);
  check((await api().post(`/api/campus/orders/${d._id}/place`).set(A).send({})).status === 400, 'making it twice is refused');
  check((await api().patch(`/api/campus/orders/${d._id}`).set(A).send({ quantity: 20 })).status === 400, 'copies locked after the order');
  const note = await api().patch(`/api/campus/orders/${d._id}`).set(A).send({ note: 'পাঠানো হবে', shipOn: '2026-10-25' });
  check(note.status === 200 && note.body?.data?.note === 'পাঠানো হবে', 'notes and dates still editable');
  const o2: any = await Order.findById(o._id).lean();
  check(shopDayOf(new Date(o2?.dispatchDate)) === '2026-10-25', 'a new ship day moves the order too');
  check((await api().delete(`/api/campus/orders/${d._id}`).set(S)).status === 400, 'a placed deal cannot be deleted');
  const spare = await api().post('/api/campus/orders').set(A).send({ collegeName: 'Some Private College', contact: { name: 'Y', phone: '01733000000' }, quantity: 3 });
  check(spare.status === 200 && spare.body?.data?.total === 1800, 'a college not in the list can be typed', spare.body);
  check((await api().delete(`/api/campus/orders/${spare.body.data._id}`).set(A)).status === 403, 'an admin cannot delete a deal');
  check((await api().delete(`/api/campus/orders/${spare.body.data._id}`).set(S)).status === 200, 'the Super Admin can');

  console.log('── Ledger ──');
  // An Accounts day starts at 5 AM (Settings.ledgerDayStartHour) — ask the server which day "today" is.
  const today = (await api().get('/api/ledger').set(S)).body?.data?.today;
  check(/^\d{4}-\d{2}-\d{2}$/.test(String(today)), 'the server names today', today);
  const e1 = await api().post('/api/ledger').set(S).send({ day: today, type: 'expense', category: 'ছাপা', amount: '৫০০০', method: 'bank' });
  check(e1.status === 200 && e1.body?.data?.amount === 5000, 'an expense, Bengali digits read', e1.body);
  await api().post('/api/ledger').set(S).send({ day: today, type: 'income', category: 'বাইরের বিক্রি', amount: 1200 });
  check((await api().post('/api/ledger').set(S).send({ day: today, type: 'expense', amount: 0 })).status === 400, 'zero refused');

  // An admin writes their own entries and sees only those — no sales, nobody else's.
  const ea = await api().post('/api/ledger').set(A).send({ day: today, type: 'expense', category: 'যাতায়াত', amount: 300 });
  await api().post('/api/ledger').set(A).send({ day: today, type: 'income', category: 'হাতে বই বিক্রি', amount: 650, book: 'personal' });
  const mine = await api().get('/api/ledger').set(A).query({ from: today, to: today });
  check(mine.status === 200 && mine.body?.data?.mine === true && mine.body?.data?.sales === false, 'admin gets their own view');
  check(mine.body?.data?.entries?.length === 2 && mine.body.data.days[0].expense === 300 && mine.body.data.days[0].income === 650, 'admin sees only their two entries', mine.body?.data?.entries);
  check(mine.body.data.days[0].orders === 0 && mine.body.data.days[0].sales === 0, 'and no sales');
  check((await api().get('/api/ledger').set(A).query({ book: 'personal' })).body?.data?.book === 'shop', 'an admin cannot open a personal book');
  check((await api().patch(`/api/ledger/${e1.body.data._id}`).set(A).send({ amount: 1 })).status === 400, "an admin cannot change the Super Admin's entry");
  check((await api().patch(`/api/ledger/${ea.body.data._id}`).set(A).send({ amount: 350 })).body?.data?.amount === 350, 'an admin corrects their own');
  check((await api().delete(`/api/ledger/${ea.body.data._id}`).set(A)).status === 403, 'an admin cannot delete');

  const rep = await api().get('/api/ledger').set(S).query({ from: today, to: today });
  const row = rep.body?.data?.days?.[0];
  check(row?.day === today && row?.expense === 5350 && row?.income === 1850, "the Super Admin's shop day includes the admin's entries", row);
  check(row?.orders === 1 && row?.sales === o.total && row?.delivery === 120, "and the day's orders", row);
  check(rep.body?.data?.entries?.some((e: any) => e.createdBy?.firstName === 'admin'), 'with who wrote each');
  check(rep.body?.data?.categories?.expense?.includes('কুরিয়ার'), 'category suggestions');

  // The Super Admin's personal book: separate, never in the shop's figures.
  await api().post('/api/ledger').set(S).send({ book: 'personal', day: today, type: 'income', category: 'দোকান থেকে নেওয়া', amount: 10000 });
  const per = await api().get('/api/ledger').set(S).query({ book: 'personal', from: today, to: today });
  check(per.body?.data?.book === 'personal' && per.body.data.days[0].income === 10000 && per.body.data.days[0].sales === 0, 'personal book on its own');
  const rep2 = await api().get('/api/ledger').set(S).query({ from: today, to: today });
  check(rep2.body?.data?.days?.[0]?.income === 1850, 'personal money not in the shop book');

  const upd = await api().patch(`/api/ledger/${e1.body.data._id}`).set(S).send({ amount: 4500 });
  check(upd.body?.data?.amount === 4500, 'an entry can be corrected');
  check((await api().get('/api/ledger').set(M)).status === 403, 'a manager cannot open the accounts');
  check((await api().delete(`/api/ledger/${e1.body.data._id}`).set(S)).status === 200, 'the Super Admin can remove an entry');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
