/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Incomplete orders (incompleteOrder module):
 *   • the checkout's autosave keeps anything typed — even just a name;
 *   • a visit's row joins the contact's row once a phone is typed;
 *   • the same phone on a new visit counts an attempt, not a new row;
 *   • placing an order marks the contact's row ordered;
 *   • manager, admin and Super Admin see the list (filters, counts); a
 *     student does not; only the Super Admin deletes.
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
  const { IncompleteOrder } = await import('../app/modules/incompleteOrder/incompleteOrder.model');
  const api = () => request(app);

  await Book.create({ id: 1, title: 'MAGIC VIVA ANATOMY', slug: 'anatomy', price: 650, format: 'printed', stock: 100 });

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
  const U = await make('student@t.com', 'student');

  const track = (body: any) => api().post('/api/incomplete-orders').send(body);

  console.log('── Autosave ──');
  check((await track({ sessionId: 'visit-aaaa-1' })).body?.data?.saved === false, 'an empty form keeps nothing');
  check((await track({ sessionId: 'bad' , name: 'x' })).status === 400, 'a bad visit id is refused');
  await track({ sessionId: 'visit-aaaa-1', name: 'Rahim', bookSlug: 'anatomy' });
  check((await IncompleteOrder.countDocuments()) === 1, 'just a name is kept');
  await track({ sessionId: 'visit-aaaa-1', name: 'Rahim Uddin', phone: '0171', quantity: 2 });
  let r: any = await IncompleteOrder.findOne().lean();
  check(r?.name === 'Rahim Uddin' && r?.typedPhone === '0171' && !r?.phone && r?.quantity === 2, 'a half-typed number kept as text', r);
  await track({ sessionId: 'visit-aaaa-1', phone: '০১৭১১-০০০০০১', collegeName: 'Khulna Medical College', payMode: 'cod' });
  r = await IncompleteOrder.findOne().lean();
  check(r?.phone === '01711000001' && r?.collegeName === 'Khulna Medical College' && r?.attempts === 1, 'the full number (Bengali digits) becomes the contact', r);

  console.log('── Same phone again ──');
  await track({ sessionId: 'visit-bbbb-2', name: 'R' }); // a new visit, phone not typed yet
  check((await IncompleteOrder.countDocuments()) === 2, 'a new visit starts its own row');
  await track({ sessionId: 'visit-bbbb-2', phone: '+8801711000001' });
  r = await IncompleteOrder.findOne({ phone: '01711000001' }).lean();
  check((await IncompleteOrder.countDocuments()) === 1 && r?.attempts === 2, 'joined into one row, counted twice', r?.attempts);
  await track({ sessionId: 'visit-bbbb-2', address: 'Hall 2' });
  check(((await IncompleteOrder.findOne().lean()) as any)?.attempts === 2, 'more typing in the same visit is not another attempt');
  await track({ sessionId: 'visit-cccc-3', phone: '01711000001' });
  check(((await IncompleteOrder.findOne().lean()) as any)?.attempts === 3, 'a third visit → 3');
  await track({ sessionId: 'visit-dddd-4', phone: '01822000002', name: 'Karim' });

  console.log('── Ordered ──');
  const ord = await api().post('/api/orders').send({
    items: [{ bookSlugOrId: 'anatomy', quantity: 1 }],
    paymentMethod: 'cod',
    medicalCollegeName: 'Khulna Medical College',
    shippingAddress: { name: 'Rahim', phone: '01711000001', address: 'Hall 2', city: 'Khulna' },
  });
  check(ord.status === 201 || ord.status === 200, 'an order placed', ord.body?.message);
  await new Promise((res) => setTimeout(res, 300));
  r = await IncompleteOrder.findOne({ phone: '01711000001' }).lean();
  check(r?.status === 'ordered' && !!r?.orderNumber, 'the row is marked ordered, with the number', r);
  check(((await IncompleteOrder.findOne({ phone: '01822000002' }).lean()) as any)?.status === 'open', 'someone else stays open');

  console.log('── Admin list ──');
  const all = await api().get('/api/incomplete-orders').set(A);
  // 01711000001 came three times and then ordered: recovered — listed, badged.
  check(all.status === 200 && all.body?.data?.counts?.total === 2 && all.body?.data?.counts?.ordered === 1 && all.body?.data?.counts?.open === 1, 'one open + one who ordered later (badged)', all.body?.data?.counts);
  const recovered = all.body.data.rows.find((r: any) => r.phone === '01711000001');
  check(recovered?.status === 'ordered' && recovered?.recovered === true && !!recovered?.orderNumber, 'the later order is shown with its number', recovered);
  const open = await api().get('/api/incomplete-orders').set(A).query({ status: 'open' });
  check(open.body.data.rows.length === 1 && open.body.data.rows[0].phone === '01822000002', 'filter: not ordered');
  check((await api().get('/api/incomplete-orders').set(A).query({ status: 'ordered' })).body?.data?.rows?.length === 1, 'filter: ordered later');
  const s = await api().get('/api/incomplete-orders').set(A).query({ q: '1822' });
  check(s.body?.data?.rows?.length === 1, 'search by part of the number', s.body?.data?.rows);

  // A visit that saved only a name, then ordered straight away: not an
  // incomplete order at all — it leaves the list.
  await track({ sessionId: 'visit-eeee-5', name: 'Only Name' });
  check((await api().get('/api/incomplete-orders').set(A)).body?.data?.counts?.total === 3, 'name-only visit listed');
  await track({ sessionId: 'visit-eeee-5', done: true, orderNumber: 'ORD-X' });
  check((await api().get('/api/incomplete-orders').set(A)).body?.data?.counts?.total === 2, 'ordered in one go → off the list');
  check(all.body?.data?.rows?.[0]?.sessions === undefined, 'visit ids are not sent to the page');
  const m = await api().get('/api/incomplete-orders').set(M);
  check(m.status === 200 && m.body?.data?.counts?.total === 2, 'a manager sees it too (recent days)');
  check((await api().get('/api/incomplete-orders').set(U)).status === 403, 'a student does not');
  check((await api().get('/api/incomplete-orders').set(A).query({ from: '2020-01-01T00:00:00Z', to: '2020-01-02T00:00:00Z' })).body?.data?.counts?.total === 0, 'date filter');

  const id = open.body.data.rows[0]._id;
  const pa = await api().patch(`/api/incomplete-orders/${id}`).set(M).send({ contacted: true, note: 'কল দিয়েছি' });
  check(pa.body?.data?.contacted === true && pa.body?.data?.note === 'কল দিয়েছি', 'marked contacted with a note');
  const todo = await api().get('/api/incomplete-orders').set(A).query({ status: 'todo' });
  check(todo.body?.data?.rows?.length === 0 && todo.body?.data?.counts?.contacted === 1 && todo.body?.data?.counts?.todo === 0, 'filter: still to call');
  check((await api().delete(`/api/incomplete-orders/${id}`).set(A)).status === 403, 'an admin cannot delete');
  check((await api().delete(`/api/incomplete-orders/${id}`).set(S)).status === 200, 'the Super Admin can');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
