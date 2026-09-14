/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Ordering without an account (isolated in-memory MongoDB, real Express app via
 * supertest; never the live DB).
 *
 * Book access comes from the code printed in the book, not from the order, so an
 * order only has to reach the right person — and a signup form in front of the
 * order button was losing buyers who could not work it out. What has to hold
 * once the account is gone:
 *
 *   - a guest can place an order, and what they typed is checked and kept
 *   - the order is still reachable by the person who placed it, and nobody else
 *   - a guest who PAYS ONLINE ends up with a paid order (before this, the
 *     settlement looked the order up by account and told them it failed)
 *   - the admin screens and the tracker do not trip over an order with no user
 *   - a signed-in buyer's order works exactly as before
 *
 * Run:  npx ts-node src/__tests__/guest-checkout.e2e.ts
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
  process.env.ORDER_CREATE_LIMIT = '1000';
  // Keep both gateways in demo mode whatever the local .env holds: no test may
  // open a session with a real payment provider.
  for (const k of ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASS', 'BKASH_APP_KEY', 'BKASH_APP_SECRET', 'BKASH_USERNAME', 'BKASH_PASSWORD']) {
    process.env[k] = '';
  }

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Book } = await import('../app/modules/book/book.model');
  const { User } = await import('../app/modules/user/user.model');
  const { Order } = await import('../app/modules/order/order.model');
  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const { Settings } = await import('../app/modules/settings/settings.model');
  const { BookCoupon } = await import('../app/modules/bookCoupon/bookCoupon.model');
  const { normalizeBdMobile, accessKeyMatches } = await import('../app/modules/order/order.service');
  const { settleGatewayPayment } = await import('../app/modules/payment/orderSettlement');
  const { mongoSettlementDeps } = await import('../app/modules/payment/orderSettlement.deps');

  const api = () => request(app);

  await Settings.create({ deliveryCharge: 120, codEnabled: true, onlinePaymentEnabled: true } as any);
  const dmc = await MedicalCollege.create({
    name: 'Dhaka Medical College', searchKey: 'dhaka medical college', type: 'government',
    division: 'ঢাকা', district: 'ঢাকা', upazila: 'শাহবাগ',
  });
  await Book.create({
    id: 1, title: 'Anatomy MAGIC VIVA', slug: 'anatomy-magic-viva',
    price: 650, author: 'Sabbir', category: 'medical', description: 'test',
    format: 'printed', stock: 500,
  });
  await Book.create({
    id: 2, title: 'Second Book', slug: 'second-book',
    price: 300, author: 'Sabbir', category: 'medical', description: 'test',
    format: 'printed', stock: 500,
  });
  await Book.create({
    id: 3, title: 'Digital Notes', slug: 'digital-notes',
    price: 200, author: 'Sabbir', category: 'medical', description: 'test',
    format: 'digital',
  });

  const address = (phone: string, extra: Record<string, unknown> = {}) => ({
    name: '  Rahim  ', phone, address: ' Hall 3, Room 12 ', city: 'শাহবাগ',
    division: 'ঢাকা', district: 'ঢাকা', upazila: 'শাহবাগ', ...extra,
  });
  const guestOrder = (body: Record<string, unknown>) =>
    api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
      medicalCollege: String(dmc._id),
      paymentMethod: 'cod',
      ...body,
    });

  console.log('\n── Phone numbers, however they are typed ──');
  {
    check(normalizeBdMobile('01712345678') === '01712345678', '01712345678 stays as it is');
    check(normalizeBdMobile('+880 1712-345678') === '01712345678', '+880 1712-345678 → 01712345678');
    check(normalizeBdMobile('8801712345678') === '01712345678', '8801712345678 → 01712345678');
    check(normalizeBdMobile('01212345678') === '', '012… is not a mobile prefix → rejected');
    check(normalizeBdMobile('1712345678') === '', 'ten digits with no leading 0 → rejected');
  }

  let guest: any;
  let guestKey = '';
  console.log('\n── A guest places a cash-on-delivery order ──');
  {
    const r = await guestOrder({
      shippingAddress: address('+880 1712-345678', { altPhone: '01898 765432', email: '  Rahim@Example.COM ' }),
    });
    guest = r.body?.data;
    guestKey = guest?.accessKey || '';
    check(r.status === 201, `no token, order created (${r.status})`, r.body?.message);
    check(!guest?.user, 'the order has no account on it');
    check(guestKey.length >= 30, `an access key comes back once, in the create response (${guestKey.length} chars)`);
    check(!('accessKeyHash' in (guest || {})), 'the stored hash is never sent out');
    check(guest?.shippingAddress?.phone === '01712345678', `phone normalised (${guest?.shippingAddress?.phone})`);
    check(guest?.shippingAddress?.altPhone === '01898765432', `second phone normalised (${guest?.shippingAddress?.altPhone})`);
    check(guest?.shippingAddress?.email === 'rahim@example.com', `email trimmed and lower-cased (${guest?.shippingAddress?.email})`);
    check(guest?.shippingAddress?.name === 'Rahim' && guest?.shippingAddress?.address === 'Hall 3, Room 12', 'name and address trimmed');
    check(
      guest?.college?.name === 'Dhaka Medical College' && guest?.college?.upazila === 'শাহবাগ',
      'the college is snapshotted onto the order, with its upazila',
      guest?.college
    );
    check(guest?.deliveryCharge === 120 && guest?.deliveryRule === 'standard', `delivery ৳120, rule standard (৳${guest?.deliveryCharge}, ${guest?.deliveryRule})`);

    const stored: any = await Order.findById(guest?._id).select('+accessKeyHash').lean();
    check(!!stored?.accessKeyHash && accessKeyMatches(stored.accessKeyHash, guestKey), 'only the key\'s hash is stored, and it matches');
    // Flip the last character to something it is not — a fixed 'x' would be a
    // no-op on the one key in 64 that already ends in 'x'.
    const offByOne = guestKey.slice(0, -1) + (guestKey.endsWith('x') ? 'y' : 'x');
    check(!accessKeyMatches(stored?.accessKeyHash, offByOne), 'a key one character off does not match');
  }

  console.log('\n── What a guest types is checked ──');
  {
    const badPhone = await guestOrder({ shippingAddress: address('12345') });
    check(badPhone.status === 400 && /মোবাইল/.test(badPhone.body?.message), `a wrong phone is refused in Bengali (${badPhone.status})`, badPhone.body?.message);

    const badAlt = await guestOrder({ shippingAddress: address('01711111111', { altPhone: '999' }) });
    check(badAlt.status === 400 && /দ্বিতীয়/.test(badAlt.body?.message), `a wrong second phone is refused (${badAlt.status})`, badAlt.body?.message);

    const badEmail = await guestOrder({ shippingAddress: address('01711111112', { email: 'not-an-email' }) });
    check(badEmail.status === 400 && /ইমেইল/.test(badEmail.body?.message), `a wrong email is refused (${badEmail.status})`, badEmail.body?.message);

    const noCollege = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
      shippingAddress: address('01711111113'),
      paymentMethod: 'cod',
    });
    check(noCollege.status === 400 && /কলেজ/.test(noCollege.body?.message), `no college → refused (${noCollege.status})`, noCollege.body?.message);

    const sameTwice = await guestOrder({ shippingAddress: address('01712345678', { altPhone: '01712345678' }) });
    // Same number as the first order + same book within minutes → the repeat guard.
    check(sameTwice.status === 400 && /কয়েক মিনিট আগেই/.test(sameTwice.body?.message), `the same COD order again from the same number → refused (${sameTwice.status})`, sameTwice.body?.message);

    const otherBook = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'second-book', quantity: 1 }],
      medicalCollege: String(dmc._id),
      paymentMethod: 'cod',
      shippingAddress: address('01712345678'),
    });
    check(otherBook.status === 201, `…but a different book from that number goes through (${otherBook.status})`, otherBook.body?.message);

    const altEqual = await guestOrder({ shippingAddress: address('01733333333', { altPhone: '+8801733333333' }) });
    check(altEqual.status === 201 && altEqual.body?.data?.shippingAddress?.altPhone === '', 'a second phone equal to the first is dropped, not stored twice');

    // A digital book opens from an account, so a guest must not be able to pay
    // for one — alone, or tucked into a parcel order.
    const before = await Order.countDocuments();
    const digitalOnly = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'digital-notes', quantity: 1 }],
      medicalCollege: String(dmc._id),
    });
    check(digitalOnly.status === 400 && /লগইন/.test(digitalOnly.body?.message), `a digital book without an account → sign in first (${digitalOnly.status})`, digitalOnly.body?.message);
    const mixed = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }, { bookSlugOrId: 'digital-notes', quantity: 1 }],
      medicalCollege: String(dmc._id),
      shippingAddress: address('01734343434'),
    });
    check(mixed.status === 400 && /লগইন/.test(mixed.body?.message), `printed + digital without an account → sign in first (${mixed.status})`, mixed.body?.message);
    check((await Order.countDocuments()) === before, 'neither attempt left an order behind');
  }

  console.log('\n── The order belongs to whoever holds its key ──');
  {
    const none = await api().get(`/api/orders/${guest._id}`);
    check(none.status === 403, `no token and no key → 403 (${none.status})`);

    const wrong = await api().get(`/api/orders/${guest._id}`).set('x-order-key', 'nope');
    check(wrong.status === 403, `a wrong key → 403 (${wrong.status})`);

    const right = await api().get(`/api/orders/${guest._id}`).set('x-order-key', guestKey);
    check(right.status === 200 && right.body?.data?.orderNumber === guest.orderNumber, `the right key → the order (${right.status})`);
    check(!('accessKeyHash' in (right.body?.data || {})), '…without the hash');
  }

  console.log('\n── Tracking by phone finds it by either number ──');
  {
    const byAlt = await api().post('/api/orders/track').send({ phone: '+8801898765432' });
    const found = (byAlt.body?.data || []).some((o: any) => o.orderNumber === guest.orderNumber);
    check(byAlt.status === 200 && found, 'the second number finds the order');
  }

  // ── Accounts ──────────────────────────────────────────────────────────────
  const tokenFor = async (email: string, role?: string, patch: Record<string, unknown> = {}) => {
    await api().post('/api/auth/register').send({
      firstName: 'A', lastName: 'B', email, password: 'pass1234', whatsappNumber: '01712345678',
    });
    await User.updateOne({ email }, { status: 'active', ...(role ? { role } : {}), ...patch });
    const token = (
      await api().post('/api/auth/login').set('x-device-id', `dev-${email}`).send({ email, password: 'pass1234' })
    ).body?.data?.accessToken;
    const user: any = await User.findOne({ email }).lean();
    return { token, id: String(user?._id) };
  };
  const admin = await tokenFor('admin@t.com', 'admin');

  console.log('\n── The admin screens take an order with no user ──');
  {
    const one = await api().get(`/api/orders/${guest._id}`).set('Authorization', `Bearer ${admin.token}`);
    check(one.status === 200, `admin opens the guest order (${one.status})`, one.body?.message);

    const list = await api().get('/api/orders').set('Authorization', `Bearer ${admin.token}`);
    const row = (list.body?.data || []).find((o: any) => o.orderNumber === guest.orderNumber);
    check(list.status === 200 && !!row && row.user == null, `the admin list includes it, user null (${list.status})`);

    const edit = await api()
      .patch(`/api/orders/${guest._id}/admin-edit`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ buyer: { email: 'new@example.com' }, shippingAddress: { altPhone: '01999999999' } });
    const after: any = await Order.findById(guest._id).lean();
    check(
      edit.status === 200 && after?.shippingAddress?.email === 'new@example.com' && after?.shippingAddress?.altPhone === '01999999999',
      'the owner\'s edit lands on the order itself — email and second phone',
      { status: edit.status, email: after?.shippingAddress?.email }
    );

    const status = await api()
      .patch(`/api/orders/${guest._id}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'processing' });
    check(status.status === 200, `confirming a guest order works (${status.status})`, status.body?.message);
  }

  console.log('\n── A guest pays online, and the payment lands ──');
  {
    const created = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
      medicalCollege: String(dmc._id),
      shippingAddress: address('01744444444'),
    });
    const order = created.body?.data;
    const key = order?.accessKey;
    check(created.status === 201 && order?.payment?.status === 'pending', `gateway order created, pending (${created.status})`, created.body?.message);

    const noKey = await api().post(`/api/orders/${order._id}/pay/sslcommerz`);
    check(noKey.status === 400 && /not found/i.test(noKey.body?.message), `paying without the key → "not found" (${noKey.status})`, noKey.body?.message);

    const withKey = await api().post(`/api/orders/${order._id}/pay/sslcommerz`).set('x-order-key', key);
    check(withKey.status === 200 && !!withKey.body?.data?.GatewayPageURL, `paying with the key opens a session (${withKey.status})`, withKey.body?.message);

    // The gateway reports success. This is the path that used to fail for a
    // guest: the order was looked up by account, "undefined" was not an id, and
    // the buyer was redirected to "payment failed" with the money taken.
    const found = await mongoSettlementDeps.findOrder({ orderNumber: order.orderNumber });
    check(found?.user === '', `settlement sees an empty user, not "undefined" ("${found?.user}")`);
    const result = await settleGatewayPayment(mongoSettlementDeps, {
      gateway: 'sslcommerz',
      orderNumber: order.orderNumber,
      transactionId: 'VAL-TEST-1',
      paidAmount: order.total,
      succeeded: true,
    } as any);
    const paid: any = await Order.findById(order._id).lean();
    check(result.outcome === 'settled', `the callback settles the order (${result.outcome})`, result);
    check(paid?.payment?.status === 'paid' && paid?.status === 'processing', `the guest's order is paid and processing (${paid?.payment?.status}, ${paid?.status})`);

    const readBack = await api().get(`/api/orders/${order._id}`).set('x-order-key', key);
    check(readBack.body?.data?.payment?.status === 'paid', 'the return page can read "paid" with the key');
  }

  console.log('\n── Coupons: one use per buyer, a guest counted by phone ──');
  {
    await BookCoupon.create({ code: 'ONCE10', discountType: 'fixed', discountValue: 10, isActive: true, maxUsesPerBuyer: 1 } as any);
    const first = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
      medicalCollege: String(dmc._id), couponCode: 'ONCE10', shippingAddress: address('01755555555'),
    });
    check(first.status === 201 && first.body?.data?.couponDiscount === 10, `first use by 01755555555 (${first.status})`, first.body?.message);

    const second = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'second-book', quantity: 1 }],
      medicalCollege: String(dmc._id), couponCode: 'ONCE10', shippingAddress: address('+8801755555555'),
    });
    check(second.status === 400 && /already used/i.test(second.body?.message), `second use by the same number → refused (${second.status})`, second.body?.message);

    const other = await api().post('/api/orders').send({
      items: [{ bookSlugOrId: 'second-book', quantity: 1 }],
      medicalCollege: String(dmc._id), couponCode: 'ONCE10', shippingAddress: address('01766666666'),
    });
    check(other.status === 201, `a different number may use it (${other.status})`, other.body?.message);

    const preview = await api().post('/api/book-coupons/validate').send({ code: 'ONCE10', amount: 650, phone: '01755555555' });
    check(preview.status === 400, `the public preview, given the used number, already says no (${preview.status})`);
    const previewAnon = await api().post('/api/book-coupons/validate').send({ code: 'ONCE10', amount: 650 });
    check(previewAnon.status === 200 && previewAnon.body?.data?.discountAmount === 10, `the preview works without a login (${previewAnon.status})`);
  }

  console.log('\n── A signed-in buyer, as before ──');
  {
    const buyer = await tokenFor('buyer@t.com', undefined, { medicalCollege: dmc._id, medicalCollegeName: dmc.name });

    const mine = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        paymentMethod: 'cod',
        // No college in the body: an older checkout. The profile's is used.
        shippingAddress: address('01777777777'),
      });
    check(mine.status === 201 && String(mine.body?.data?.user) === buyer.id, `the order is linked to the account (${mine.status})`, mine.body?.message);
    check(mine.body?.data?.college?.name === 'Dhaka Medical College', 'no college in the body → the profile\'s college');

    const myDigital = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ items: [{ bookSlugOrId: 'digital-notes', quantity: 1 }] });
    check(myDigital.status === 201 && myDigital.body?.data?.deliveryType === 'digital', `a signed-in buyer still buys a digital book (${myDigital.status})`, myDigital.body?.message);

    const myList = await api().get('/api/orders/my').set('Authorization', `Bearer ${buyer.token}`);
    check((myList.body?.data || []).some((o: any) => o._id === mine.body?.data?._id), 'it shows in "my orders"');

    const own = await api().get(`/api/orders/${mine.body?.data?._id}`).set('Authorization', `Bearer ${buyer.token}`);
    check(own.status === 200, `the owner reads it without a key (${own.status})`);

    const stranger = await tokenFor('stranger@t.com');
    const theirs = await api().get(`/api/orders/${mine.body?.data?._id}`).set('Authorization', `Bearer ${stranger.token}`);
    check(theirs.status === 403, `another account cannot (${theirs.status})`);
    const guestsOrder = await api().get(`/api/orders/${guest._id}`).set('Authorization', `Bearer ${stranger.token}`);
    check(guestsOrder.status === 403, `…nor read a guest's order just by being signed in (${guestsOrder.status})`);

    const forged = await api().post('/api/orders').set('Authorization', 'Bearer not-a-token').send({
      items: [{ bookSlugOrId: 'second-book', quantity: 1 }],
      medicalCollege: String(dmc._id), paymentMethod: 'cod', shippingAddress: address('01788888888'),
    });
    check(forged.status === 201 && !forged.body?.data?.user, 'a forged token is simply a guest — no account attached', forged.body?.message);
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
