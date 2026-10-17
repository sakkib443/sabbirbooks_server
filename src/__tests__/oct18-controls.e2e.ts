/* eslint-disable no-console */
/**
 * The 18 Oct 2026 controls:
 *   • the shop day's cutoff hour is a setting, and the server cuts days by it;
 *   • saved "video missing" messages, and putting one on many questions;
 *   • the Super Admin narrows an admin (courier.manage) and a manager
 *     (coupons.write), and switches a staff account's access off and on;
 *   • no SMS when an order is delivered; no staff bell line per book order.
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
  const { User } = await import('../app/modules/user/user.model');
  const shopDay = await import('../app/utils/shopDay');
  const { OrderSmsService } = await import('../app/modules/notification/orderSms.service');
  const api = () => request(app);

  const make = async (email: string, role: string) => {
    await api().post('/api/auth/register').send({ firstName: role, lastName: 'T', email, password: 'pass1234', whatsappNumber: '01712345678' });
    await User.updateOne({ email }, { role, status: 'active' });
    await approveDevice(email, `d-${email}`);
    const r = await api().post('/api/auth/login').set('x-device-id', `d-${email}`).send({ email, password: 'pass1234' });
    return { token: r.body?.data?.accessToken as string, id: String((await User.findOne({ email }).lean() as any)._id) };
  };
  const owner = await make('owner@t.com', 'superAdmin');
  const admin = await make('admin@t.com', 'admin');
  const manager = await make('manager@t.com', 'manager');
  const S = { Authorization: `Bearer ${owner.token}` };
  const A = { Authorization: `Bearer ${admin.token}` };
  const M = { Authorization: `Bearer ${manager.token}` };

  console.log('── Day cutoff ──');
  check(shopDay.cutoffOf('2026-10-18').toISOString() === '2026-10-18T06:00:00.000Z', 'default: noon BD (06:00 UTC)');
  const set9 = await api().patch('/api/settings').set(S).send({ shopDayCutoffHour: 9 });
  check(set9.status === 200 && set9.body?.data?.shopDayCutoffHour === 9, 'Super Admin sets 9 AM', set9.body);
  check(shopDay.cutoffOf('2026-10-18').toISOString() === '2026-10-18T03:00:00.000Z', 'the server now cuts at 9 AM BD');
  check(shopDay.shopDayOf(new Date('2026-10-18T04:00:00Z')) === '2026-10-19', '10 AM BD belongs to the next day');
  await api().patch('/api/settings').set(S).send({ shopDayCutoffHour: 0 });
  check(shopDay.dayWindow('2026-10-18').$gte.toISOString() === '2026-10-17T18:00:00.000Z', 'midnight: the day named 18 Oct starts 18 Oct 00:00 BD');
  check(shopDay.shopDayOf(new Date('2026-10-18T17:00:00Z')) === '2026-10-18', '11 PM BD stays on its own date');
  const bad = await api().patch('/api/settings').set(S).send({ shopDayCutoffHour: 30 });
  check(bad.status >= 400, 'an hour out of range is refused', bad.status);
  check((await api().patch('/api/settings').set(M).send({ shopDayCutoffHour: 5 })).status === 403, 'a manager cannot change it');
  await api().patch('/api/settings').set(S).send({ shopDayCutoffHour: 12 });

  console.log('── Saved video messages ──');
  const add = await api().post('/api/book-content/video-note-presets').set(A).send({ text: 'ভিডিও শীঘ্রই আসছে' });
  check(add.status === 200 && add.body?.data?.text === 'ভিডিও শীঘ্রই আসছে', 'a message is saved', add.body);
  await api().post('/api/book-content/video-note-presets').set(A).send({ text: 'ভিডিও শীঘ্রই আসছে' });
  const list = (await api().get('/api/book-content/video-note-presets').set(A)).body?.data || [];
  check(list.length === 1, 'saving it twice keeps one', list.length);
  const { Book } = await import('../app/modules/book/book.model');
  const { BookQuestion } = await import('../app/modules/bookContent/bookContent.model');
  const book: any = await Book.create({ id: 9, title: 'B', slug: 'b9', price: 1, format: 'printed' });
  const notes = (await api().get(`/api/book-content/video-notes/${book._id}`).set(A)).body?.data || [];
  check(notes[0] === 'ভিডিও শীঘ্রই আসছে', 'the editor list offers the saved message', notes);
  const q: any = await BookQuestion.collection.insertOne({ bookId: book._id, topicId: book._id, questionNo: '1', questionText: 'Q', videos: [], isDeleted: false, order: 1 });
  const put = await api().patch('/api/book-content/video-note-visibility').set(A).send({ show: true, note: 'ভিডিও শীঘ্রই আসছে', questionIds: [String(q.insertedId)] });
  const after: any = await BookQuestion.collection.findOne({ _id: q.insertedId });
  check(put.status === 200 && after.videoNote === 'ভিডিও শীঘ্রই আসছে' && after.hideVideoNote === false, 'the message is put on a question', after);
  await api().patch('/api/book-content/video-note-visibility').set(A).send({ show: true, note: '', questionIds: [String(q.insertedId)] });
  const cleared: any = await BookQuestion.collection.findOne({ _id: q.insertedId });
  check(cleared.videoNote === '' && cleared.hideVideoNote === true, 'and taken off again', cleared);
  check((await api().delete(`/api/book-content/video-note-presets/${list[0]._id}`).set(A)).status === 200, 'a saved message can be removed');

  console.log('── Permissions ──');
  check((await api().get('/api/courier/status').set(A)).status === 200, 'admin runs the courier by default');
  check((await api().get('/api/courier/status').set(M)).status === 403, 'a manager does not');
  const narrowed = await api().patch(`/api/user/${admin.id}/permissions`).set(S).send({ permissions: ['orders.read', 'orders.write'] });
  check(narrowed.status === 200, 'Super Admin narrows the admin', narrowed.body);
  check((await api().get('/api/courier/status').set(A)).status === 403, 'the admin loses the courier at once');
  check((await api().get('/api/orders').set(A)).status === 200, '…but keeps the orders');
  check((await api().patch(`/api/user/${manager.id}/permissions`).set(A).send({ permissions: ['coupons.write'] })).status === 403, 'an admin cannot set permissions');
  check((await api().post('/api/book-coupons').set(M).send({ code: 'M1', discountType: 'fixed', discountValue: 5 })).status === 403, 'manager: no coupon writing by default');
  await api().patch(`/api/user/${manager.id}/permissions`).set(S).send({ permissions: ['content.write', 'orders.read', 'orders.write', 'coupons.write', 'courier.manage'] });
  const mc = await api().post('/api/book-coupons').set(M).send({ code: 'M1', discountType: 'fixed', discountValue: 5 });
  check(mc.status === 201 || mc.status === 200, 'once given coupons.write, the manager creates one', mc.status);
  check((await api().get('/api/courier/status').set(M)).status === 200, 'and with courier.manage, runs the courier');
  const me = (await api().get('/api/auth/me').set(M)).body?.data;
  check(me?.capabilities?.includes('coupons.write'), '/auth/me reports the new capability', me?.capabilities);

  console.log('── Access off / on ──');
  const off = await api().post(`/api/security/users/${manager.id}/access`).set(S).send({ enabled: false });
  check(off.status === 200 && off.body?.data?.status === 'blocked', 'Super Admin switches the manager off', off.body);
  check((await api().get('/api/orders').set(M)).status === 401, 'the manager is signed out at once');
  const relog = await api().post('/api/auth/login').set('x-device-id', 'd-manager@t.com').send({ email: 'manager@t.com', password: 'pass1234' });
  check(relog.status === 401, 'and cannot sign in', relog.status);
  check((await api().post(`/api/security/users/${owner.id}/access`).set(S).send({ enabled: false })).status === 400, 'the Super Admin cannot be switched off');
  await api().post(`/api/security/users/${manager.id}/access`).set(S).send({ enabled: true });
  const back = await api().post('/api/auth/login').set('x-device-id', 'd-manager@t.com').send({ email: 'manager@t.com', password: 'pass1234' });
  check(back.status === 200, 'switched back on, the manager signs in again', back.status);
  check((await api().post(`/api/security/users/${manager.id}/access`).set(A).send({ enabled: false })).status === 403, 'an admin cannot switch anyone off');

  console.log('── Messages ──');
  check(OrderSmsService.shouldSend('delivered', { status: 'delivered', payment: { method: 'cod' } }) === false, 'no SMS when an order is delivered');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
