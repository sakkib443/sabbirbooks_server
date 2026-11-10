/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Courier (Pathao, 1 Nov 2026) — login, send, the city/zone fallback, status
 * sync, the webhook (integration check, signature, events) and the buyer's
 * tracking page, against an in-memory MongoDB and a fake Pathao API on
 * localhost. Nothing here reaches the real courier.
 */
import http from 'http';
import { AddressInfo } from 'net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); } else { failed++; console.log(`  ❌ ${msg}`, detail ?? ''); }
}

// ── The fake Pathao ──────────────────────────────────────────
const fake = {
  logins: [] as any[],
  orders: [] as any[],
  status: new Map<string, string>(),
  token: 'tok1',
  nextToken: 'tok1',
  requireCity: false,
  n: 100,
};
const fakeServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code: number, o: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(o));
    };
    const url = req.url || '';
    const json = body ? JSON.parse(body) : {};
    if (req.method === 'POST' && url === '/aladdin/api/v1/issue-token') {
      fake.logins.push(json);
      if (json.grant_type !== 'password' || json.password !== 'p$ss$word') return send(401, { message: 'Invalid credentials' });
      fake.token = fake.nextToken;
      return send(200, { token_type: 'Bearer', expires_in: 432000, access_token: fake.token, refresh_token: 'r' });
    }
    if (req.headers.authorization !== `Bearer ${fake.token}`) return send(401, { message: 'Unauthenticated.' });
    if (req.method === 'POST' && url === '/aladdin/api/v1/orders') {
      fake.orders.push(json);
      if (json.recipient_phone === '01999999999') return send(422, { message: 'Validation failed', errors: { recipient_phone: ['The recipient phone is invalid.'] } });
      if (fake.requireCity && !json.recipient_city) return send(422, { message: 'Validation failed', errors: { recipient_city: ['The recipient city field is required.'] } });
      const id = `DL1101${++fake.n}XYZ`;
      fake.status.set(id, 'Pending');
      return send(200, { message: 'Order Created Successfully', type: 'success', code: 200, data: { consignment_id: id, merchant_order_id: json.merchant_order_id, order_status: 'Pending', delivery_fee: 60 } });
    }
    const info = url.match(/\/aladdin\/api\/v1\/orders\/([A-Z0-9]+)\/info/);
    if (info) return send(200, { type: 'success', data: { consignment_id: info[1], order_status: fake.status.get(info[1]) || 'Pending' } });
    if (url === '/aladdin/api/v1/city-list') return send(200, { data: { data: [{ city_id: 1, city_name: 'Dhaka' }, { city_id: 2, city_name: 'Khulna' }] } });
    if (url === '/aladdin/api/v1/cities/2/zone-list') return send(200, { data: { data: [{ zone_id: 51, zone_name: 'Khulna Sadar' }, { zone_id: 50, zone_name: 'Sonadanga' }] } });
    send(404, { message: 'not found' });
  });
});

async function main() {
  await new Promise<void>((r) => fakeServer.listen(0, '127.0.0.1', () => r()));
  const port = (fakeServer.address() as AddressInfo).port;

  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.STEADFAST_API_KEY = '';
  process.env.STEADFAST_SECRET_KEY = '';
  process.env.PATHAO_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.PATHAO_CLIENT_ID = 'cid';
  process.env.PATHAO_CLIENT_SECRET = 'csecret';
  process.env.PATHAO_USERNAME = 'shop@example.com';
  process.env.PATHAO_PASSWORD = 'p$ss$word';
  process.env.PATHAO_STORE_ID = '441295';
  process.env.PATHAO_WEBHOOK_SECRET = 'whsec-123';

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
  const owner = await registerLogin('owner@test.com', 'o1', 'superAdmin');
  const AUTH = { Authorization: `Bearer ${owner}` };
  const place = async (phone: string, qty = 1) => {
    const r = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyer}`)
      .send({
        items: [{ bookSlugOrId: 'book-1', quantity: qty }],
        shippingAddress: { name: 'Rahim', phone, address: 'Hall 3, KMC', city: 'Sonadanga', district: 'Khulna' },
        paymentMethod: 'cod',
      });
    if (!r.body?.data) console.log('place failed', phone, r.status, r.body?.message);
    return r.body?.data;
  };

  console.log('── Connection ──');
  const st = await api().get('/api/courier/status').set(AUTH);
  check(st.body?.data?.pathao?.configured === true && st.body?.data?.pathao?.error === null, 'status: Pathao set up and its login works', st.body?.data);
  const login = fake.logins[0] || {};
  check(login.client_id === 'cid' && login.client_secret === 'csecret' && login.username === 'shop@example.com' && login.grant_type === 'password', 'login sends client id/secret + panel login (password grant)', login);
  check(login.password === 'p$ss$word', 'a password with $ in it arrives whole');

  console.log('── Send ──');
  const o1 = await place('01711111111', 3);
  const o2 = await place('01999999999');
  const sent = await api().post('/api/courier/send').set(AUTH).send({ orderIds: [o1._id, o2._id], provider: 'pathao' });
  const byNo = new Map((sent.body?.data || []).map((r: any) => [r.orderNumber, r]));
  check((byNo.get(o1.orderNumber) as any)?.ok === true, 'order 1 accepted by Pathao', sent.body);
  check(/phone is invalid/.test((byNo.get(o2.orderNumber) as any)?.error || ''), "Pathao's refusal reason is shown per order", byNo.get(o2.orderNumber));
  const p1 = fake.orders.find((p) => p.merchant_order_id === o1.orderNumber) || {};
  check(p1.store_id === 441295 && p1.delivery_type === 48 && p1.item_type === 2, 'store id, normal delivery, parcel', p1);
  check(p1.amount_to_collect === o1.total && p1.item_quantity === 3 && p1.item_weight === 1.5, 'COD = order total; 3 books = 1.5 kg', p1);
  check(p1.recipient_phone === '01711111111' && /Hall 3/.test(p1.recipient_address) && !('recipient_city' in p1), 'phone 11 digits, address sent, no city/zone needed', p1);
  const d1: any = await Order.findById(o1._id).lean();
  check(d1.status === 'shipped' && d1.courier?.provider === 'pathao' && d1.courierName === 'Pathao', 'order shipped, marked as Pathao');
  check(d1.courier?.deliveryCharge === 60 && d1.trackingUrl === `https://magicviva.com/t/${d1.courier.consignmentId}`, "Pathao's fee stored; our tracking link", d1.courier);

  console.log('── City/zone only when Pathao insists ──');
  fake.requireCity = true;
  const o3 = await place('01733333333');
  const s3 = await api().post('/api/courier/send').set(AUTH).send({ orderIds: [o3._id], provider: 'pathao' });
  const p3 = fake.orders.filter((p) => p.merchant_order_id === o3.orderNumber).pop() || {};
  check(s3.body?.data?.[0]?.ok === true && p3.recipient_city === 2 && p3.recipient_zone === 50, 'refused without city → Khulna / Sonadanga looked up and sent again', p3);
  fake.requireCity = false;

  console.log('── Status sync (and a token that expired) ──');
  fake.nextToken = 'tok2';
  fake.token = 'expired'; // the held token no longer works
  fake.status.set(d1.courier.consignmentId, 'In_Transit');
  await api().post('/api/courier/sync').set(AUTH).send({ orderIds: [o1._id] });
  let s1: any = await Order.findById(o1._id).lean();
  check(s1.courier.status === 'pending' && s1.courier.providerStatus === 'In Transit', 'In Transit recorded (logged in again after the 401)', s1.courier);
  check(s1.courier.history.some((h: any) => h.message === 'Pathao: In Transit'), "Pathao's step is on the timeline");
  fake.status.set(d1.courier.consignmentId, 'At the Sorting HUB');
  await api().post('/api/courier/sync').set(AUTH).send({ orderIds: [o1._id] });
  s1 = await Order.findById(o1._id).lean();
  check(s1.courier.history.some((h: any) => h.message === 'Pathao: At The Sorting HUB'), 'a new step in the same group still reaches the timeline');
  fake.status.set(d1.courier.consignmentId, 'Delivered');
  await api().post('/api/courier/sync').set(AUTH).send({ orderIds: [o1._id] });
  s1 = await Order.findById(o1._id).lean();
  check(s1.courier.status === 'delivered' && s1.status === 'delivered', 'Delivered → the order is delivered');

  console.log('── Tracking page ──');
  const tr = await api().get(`/api/courier/track/${d1.courier.consignmentId}`);
  check(tr.status === 200 && tr.body?.data?.courier?.name === 'Pathao', 'public tracking finds a Pathao parcel and names the courier', tr.body?.data?.courier);

  console.log('── Webhook ──');
  const integ = await api().post('/api/courier/webhook/pathao').set('X-Pathao-Merchant-Webhook-Integration-Secret', 'uuid-from-pathao').send({ event: 'webhook_integration' });
  check(integ.status === 202 && integ.headers['x-pathao-merchant-webhook-integration-secret'] === 'uuid-from-pathao', 'integration check: 202 and the header echoed', { s: integ.status, h: integ.headers });
  const d3: any = await Order.findById(o3._id).lean();
  const ev = { consignment_id: d3.courier.consignmentId, merchant_order_id: o3.orderNumber, event: 'order.returned', delivery_fee: 30 };
  check((await api().post('/api/courier/webhook/pathao').send(ev)).status === 401, 'event without the signature → refused');
  check((await api().post('/api/courier/webhook/pathao').set('X-PATHAO-Signature', 'wrong-secret').send(ev)).status === 401, 'wrong signature → refused');
  const ok = await api().post('/api/courier/webhook/pathao').set('X-PATHAO-Signature', 'whsec-123').send(ev);
  const r3: any = await Order.findById(o3._id).lean();
  check(ok.status === 202 && r3.courier.status === 'cancelled' && r3.status === 'returned', 'order.returned → parcel back, order Returned', { s: ok.status, c: r3.courier.status, o: r3.status });
  check(r3.courier.deliveryCharge === 30, "return fee from Pathao recorded");
  const paid = await api().post('/api/courier/webhook/pathao').set('X-PATHAO-Signature', 'whsec-123').send({ consignment_id: d1.courier.consignmentId, event: 'order.paid', invoice_id: 'INV-77' });
  const pd: any = await Order.findById(o1._id).lean();
  check(paid.status === 202 && pd.courier.paymentId === 'INV-77' && pd.courier.status === 'delivered', 'order.paid → marked paid out, status unchanged', pd.courier);

  console.log('── Money: each courier on its own ──');
  const o5 = await place('01755555555', 2);
  await api().post('/api/courier/send').set(AUTH).send({ orderIds: [o5._id], provider: 'pathao' });
  const d5: any = await Order.findById(o5._id).lean();
  fake.status.set(d5.courier.consignmentId, 'Delivered');
  await api().post('/api/courier/sync').set(AUTH).send({ orderIds: [o5._id] });
  const owed = o5.total - 60;
  const dash = (await api().get('/api/courier/dashboard').set(AUTH).query({ provider: 'pathao' })).body?.data || {};
  check(dash.provider === 'pathao' && dash.byCourier?.pathao?.receivable === owed && dash.byCourier?.pathao?.receivableParcels === 1, 'dashboard: Pathao owes this parcel (COD − its fee)', dash.byCourier);
  check(dash.byCourier?.steadfast?.parcels === 0 && dash.balance === null && (dash.payments || []).length === 0, 'Pathao view: no Steadfast balance or payouts mixed in');
  check(dash.pathaoPaidOut === o1.total * 0 + (s1.courier.collectedAmount - 60), "Pathao's paid-out money = the parcel the webhook marked paid", dash.pathaoPaidOut);
  const listP = (await api().get('/api/courier/consignments').set(AUTH).query({ provider: 'pathao' })).body?.data;
  const listS = (await api().get('/api/courier/consignments').set(AUTH).query({ provider: 'steadfast' })).body?.data;
  check(listP?.total === 3 && listS?.total === 0, 'parcel list filters by courier', { p: listP?.total, s: listS?.total });
  const mk = await api().post('/api/courier/pathao/mark-paid').set(AUTH).send({ orderIds: [o5._id, o3._id], reference: 'PINV-9' });
  const m5: any = await Order.findById(o5._id).lean();
  check(mk.body?.data?.marked === 1 && mk.body?.data?.skipped === 1 && m5.courier.paymentId === 'pathao:PINV-9', 'mark paid by hand: the delivered one only (a returned one is skipped)', mk.body);
  const dash2 = (await api().get('/api/courier/dashboard').set(AUTH).query({ provider: 'pathao' })).body?.data || {};
  check(dash2.byCourier?.pathao?.receivable === 0, 'after marking, Pathao owes nothing');
  const sum = (await api().get('/api/courier/summary').set(AUTH).query({ provider: 'pathao' })).body?.data || {};
  check(sum.receivable === 0 && sum.payoutsReceived === dash2.pathaoPaidOut && sum.payoutCount === 2, 'accounts by date: Pathao payouts counted', sum);
  check((await api().post('/api/courier/pathao/mark-paid').set('Authorization', `Bearer ${buyer}`).send({ orderIds: [o5._id] })).status === 403, 'only the Super Admin can mark money paid');

  console.log('── Steadfast is not touched ──');
  const o4 = await place('01744444444');
  const sf = await api().post('/api/courier/send').set(AUTH).send({ orderIds: [o4._id] });
  check(sf.status === 400 && /Steadfast is not set up/.test(sf.body?.message || ''), 'no provider = Steadfast, as before (here not set up)', sf.body);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  fakeServer.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
