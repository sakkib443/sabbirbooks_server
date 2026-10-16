/* eslint-disable no-console */
/**
 * Courier (Steadfast) — send, status, webhook, payouts and the money summary,
 * against an in-memory MongoDB and a fake Steadfast API on localhost. Nothing
 * here reaches the real courier.
 */
import http from 'http';
import { AddressInfo } from 'net';
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

// ── The fake courier ─────────────────────────────────────────
const fake = {
  seen: [] as any[],
  headers: [] as any[],
  status: new Map<string, string>(),
  nextId: 9000,
  payments: [] as any[],
};
const fakeServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    fake.headers.push(req.headers);
    const send = (o: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(o));
    };
    const url = req.url || '';
    if (req.method === 'POST' && url.endsWith('/create_order/bulk-order')) {
      const parcels = JSON.parse(JSON.parse(body).data);
      fake.seen.push(...parcels);
      return send(
        parcels.map((p: any) =>
          p.recipient_phone === '01999999999'
            ? { invoice: p.invoice, consignment_id: null, tracking_code: null, status: 'error', error: 'Blocked number' }
            : (() => {
                const id = String(++fake.nextId);
                fake.status.set(id, 'in_review');
                return { invoice: p.invoice, consignment_id: Number(id), tracking_code: `TRK${id}`, status: 'success' };
              })()
        )
      );
    }
    const m = url.match(/\/status_by_cid\/(\d+)/);
    if (m) return send({ status: 200, delivery_status: fake.status.get(m[1]) || 'unknown' });
    if (url.endsWith('/get_balance')) return send({ status: 200, current_balance: 1234.5 });
    if (url.endsWith('/payments')) return send(fake.payments.map(({ consignments, ...p }) => p));
    const pm = url.match(/\/payments\/(\w+)/);
    if (pm) return send(fake.payments.find((p) => String(p.id) === pm[1]) || {});
    res.statusCode = 404;
    send({ message: 'not found' });
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
  process.env.STEADFAST_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  process.env.STEADFAST_API_KEY = 'test-key';
  process.env.STEADFAST_SECRET_KEY = 'test-secret';
  process.env.STEADFAST_WEBHOOK_TOKEN = 'hook-token-123';

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
  const AUTH = { Authorization: `Bearer ${admin}` };

  const place = async (phone: string) => {
    const r = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyer}`)
      .send({
        items: [{ bookSlugOrId: 'book-1', quantity: 1 }],
        shippingAddress: { name: 'Rahim', phone, address: 'Hall 3', city: 'Sonadanga', district: 'Khulna' },
        paymentMethod: 'cod',
      });
    return r.body?.data;
  };

  console.log('── Access ──');
  check((await api().get('/api/courier/status')).status === 401, 'courier pages need sign-in');
  check((await api().get('/api/courier/status').set('Authorization', `Bearer ${buyer}`)).status === 403, 'a buyer cannot open them');
  const st = await api().get('/api/courier/status').set(AUTH);
  check(st.body?.data?.configured === true && st.body?.data?.balance === 1234.5, 'status shows configured + live balance', st.body);

  console.log('── Send ──');
  const o1 = await place('01711111111');
  const o2 = await place('+880 1722-222222');
  const o3 = await place('01999999999'); // the fake courier refuses this one
  // Checkout itself refuses a bad number, so make one the way an old order or
  // an admin edit could have: straight in the database.
  const o4 = await place('01744444444');
  await Order.updateOne({ _id: o4._id }, { $set: { 'shippingAddress.phone': '12345' } });
  const ready = await api().get('/api/courier/ready').set(AUTH);
  check(ready.body?.data?.total === 4, 'all four confirmed orders are ready to send', ready.body?.data?.total);
  check(ready.body?.data?.rows?.[0]?.codAmount === o1.total, 'ready list shows the COD amount = order total', ready.body?.data?.rows?.[0]);

  const sent = await api().post('/api/courier/send').set(AUTH).send({ orderIds: [o1._id, o2._id, o3._id, o4._id] });
  const byNo = new Map((sent.body?.data || []).map((r: any) => [r.orderNumber, r]));
  check((byNo.get(o1.orderNumber) as any)?.ok === true, 'order 1 accepted by the courier');
  check((byNo.get(o2.orderNumber) as any)?.ok === true, 'order 2 (phone typed +880 with dashes) accepted');
  check((byNo.get(o3.orderNumber) as any)?.error === 'Blocked number', 'courier refusal is reported per order');
  check(/valid BD mobile/.test((byNo.get(o4.orderNumber) as any)?.error || ''), 'bad phone refused before sending');
  check(fake.seen.length === 3, 'only valid parcels went to the courier', fake.seen.length);
  const p2 = fake.seen.find((p) => p.invoice === o2.orderNumber);
  check(p2?.recipient_phone === '01722222222', 'phone sent as 11 digits', p2?.recipient_phone);
  check(p2?.cod_amount === o2.total, 'COD amount = order total');
  check(/Hall 3/.test(p2?.recipient_address) && /Khulna/.test(p2?.recipient_address), 'address includes area and district', p2?.recipient_address);
  check(fake.headers.some((h) => h['api-key'] === 'test-key' && h['secret-key'] === 'test-secret'), 'Api-Key / Secret-Key headers sent');

  const d1: any = await Order.findById(o1._id).lean();
  check(d1.status === 'shipped' && !!d1.shippedAt, 'sent order moved to shipped');
  check(d1.courier?.consignmentId && d1.trackingUrl === `https://steadfast.com.bd/t/${d1.courier.trackingCode}`, 'consignment + tracking link stored');
  const again = await api().post('/api/courier/send').set(AUTH).send({ orderIds: [o1._id] });
  check(/Already sent/.test(again.body?.data?.[0]?.error || ''), 'cannot send the same order twice');
  const ready2 = await api().get('/api/courier/ready').set(AUTH);
  check(ready2.body?.data?.total === 2, 'sent orders leave the ready list', ready2.body?.data?.total);

  console.log('── Held orders stay ──');
  const held = await place('01755555555');
  await api().patch(`/api/orders/${held._id}/status`).set(AUTH).send({ status: 'pending' });
  const ready3 = await api().get('/api/courier/ready').set(AUTH);
  check(!(ready3.body?.data?.rows || []).some((r: any) => r._id === held._id), 'a pending (held) order is not offered for sending');
  const heldSend = await api().post('/api/courier/send').set(AUTH).send({ orderIds: [held._id] });
  check(/pending/i.test(heldSend.body?.data?.[0]?.error || ''), 'and is refused if sent anyway', heldSend.body?.data);
  await Order.deleteOne({ _id: held._id });

  console.log('── Status sync ──');
  const d2: any = await Order.findById(o2._id).lean();
  fake.status.set(d1.courier.consignmentId, 'delivered');
  fake.status.set(d2.courier.consignmentId, 'cancelled');
  const sync = await api().post('/api/courier/sync').set(AUTH).send({});
  check(sync.body?.data?.changed === 2, 'sync found two changes', sync.body?.data);
  const d1b: any = await Order.findById(o1._id).lean();
  check(d1b.status === 'delivered' && d1b.payment?.status === 'paid', 'delivered parcel → order delivered + COD paid');
  check(d1b.courier.collectedAmount === o1.total, 'collected = COD amount on delivery');
  const d2b: any = await Order.findById(o2._id).lean();
  check(d2b.courier.status === 'cancelled' && d2b.status === 'shipped', 'returned parcel recorded, order left for the admin to decide');

  console.log('── Webhook ──');
  const o5 = await place('01733333333');
  await api().post('/api/courier/send').set(AUTH).send({ orderIds: [o5._id] });
  const d5: any = await Order.findById(o5._id).lean();
  const hook = { notification_type: 'delivery_status', consignment_id: Number(d5.courier.consignmentId), invoice: o5.orderNumber, cod_amount: o5.total, status: 'delivered', delivery_charge: 110, tracking_message: 'Delivered to customer', updated_at: '2026-10-17 10:00:00' };
  check((await api().post('/api/courier/webhook/steadfast').send(hook)).status === 401, 'webhook without token refused');
  check((await api().post('/api/courier/webhook/steadfast').set('Authorization', 'Bearer wrong-token-xyz').send(hook)).status === 401, 'webhook with wrong token refused');
  const ok = await api().post('/api/courier/webhook/steadfast').set('Authorization', 'Bearer hook-token-123').send(hook);
  check(ok.status === 200 && ok.body?.status === 'success', 'webhook with right token accepted');
  const d5b: any = await Order.findById(o5._id).lean();
  check(d5b.status === 'delivered' && d5b.courier.deliveryCharge === 110 && d5b.courier.lastMessage === 'Delivered to customer', 'webhook delivered → order delivered, charge + message stored');

  console.log('── Payouts ──');
  fake.payments.push({
    id: 77, amount: o1.total - 120, status: 'paid', created_at: '2026-10-17T08:00:00Z',
    consignments: [{ consignment_id: Number(d1.courier.consignmentId), invoice: o1.orderNumber, cod_amount: o1.total, delivery_charge: 120, status: 'delivered' }],
  });
  const ps = await api().post('/api/courier/payments/sync').set(AUTH).send({});
  check(ps.body?.data?.added === 1, 'payout copied', ps.body?.data);
  const d1c: any = await Order.findById(o1._id).lean();
  check(d1c.courier.paymentId === '77' && d1c.courier.deliveryCharge === 120, 'parcel marked paid out with its charge');
  const ps2 = await api().post('/api/courier/payments/sync').set(AUTH).send({});
  check(ps2.body?.data?.added === 0 && ps2.body?.data?.updated === 0, 'second payout sync changes nothing');

  console.log('── Summary ──');
  const sum = (await api().get('/api/courier/summary').set(AUTH)).body?.data;
  check(sum.parcels === 3, 'three parcels at the courier', sum.parcels);
  check(sum.delivered === 2 && sum.returned === 1 && sum.transit === 0, 'groups: 2 delivered, 1 returned', sum);
  check(sum.codCollected === o1.total + o5.total, 'COD collected = the two delivered totals', sum.codCollected);
  check(sum.paidOut === o1.total - 120, 'paid out = collected − charge on the settled parcel', sum.paidOut);
  check(sum.receivable === o5.total - 110, 'receivable = collected − charge on the delivered, unpaid parcel', sum.receivable);
  check(sum.payoutsReceived === o1.total - 120 && sum.payoutCount === 1, 'payouts received total', sum);
  check(sum.chargesUnknown === 1, 'the return with no reported charge is flagged', sum.chargesUnknown);

  console.log('── List + filters ──');
  const all = (await api().get('/api/courier/consignments').set(AUTH)).body?.data;
  check(all.total === 3 && all.tabs.delivered === 2 && all.tabs.returned === 1, 'list + tab counts', all.tabs);
  const ret = (await api().get('/api/courier/consignments?group=returned').set(AUTH)).body?.data;
  check(ret.total === 1 && ret.rows[0].orderNumber === o2.orderNumber, 'returned tab');
  const unsettled = (await api().get('/api/courier/consignments?group=delivered&settled=no').set(AUTH)).body?.data;
  check(unsettled.total === 1 && unsettled.rows[0].orderNumber === o5.orderNumber, 'delivered + not paid out');
  const search = (await api().get(`/api/courier/consignments?q=${d5.courier.trackingCode}`).set(AUTH)).body?.data;
  check(search.total === 1, 'search by tracking code');
  const byPhone = (await api().get('/api/courier/consignments?q=01711111111').set(AUTH)).body?.data;
  check(byPhone.total === 1 && byPhone.rows[0].orderNumber === o1.orderNumber, 'search by phone');
  const future = (await api().get('/api/courier/consignments?from=2099-01-01T00:00:00Z').set(AUTH)).body?.data;
  check(future.total === 0, 'date filter');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  fakeServer.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
