/* eslint-disable no-console */
/**
 * Campus Ambassador — application to live coupon (isolated in-memory MongoDB,
 * real Express app via supertest — never touches the live DB).
 *
 * The rules being pinned down:
 *   apply        → public, numbered MVA-AMB-0001, always 'pending'
 *   money        → ৳20 off the buyer, ৳30 to the ambassador — from constants,
 *                  never from anything the applicant typed
 *   code         → DMC + SAKIB + 20, and a second DMC Sakib gets a different one
 *   approve      → coupon live + an affiliate login whose password is their phone
 *   reject       → coupon dark, application kept
 *   re-approve   → the SAME code comes back, because orders reference it
 *   id card      → not readable by the public, or by another ambassador
 *
 * Run:  npx ts-node src/__tests__/ambassador.e2e.ts
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

const AGREEMENT = {
  accurateInfo: true,
  approvalRequired: true,
  responsibleUse: true,
  honestPromotion: true,
  noFalseClaims: true,
  shopMayTerminate: true,
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const { MedicalCollegeService } = await import(
    '../app/modules/medicalCollege/medicalCollege.service'
  );
  const { AmbassadorApplication } = await import('../app/modules/ambassador/ambassador.model');
  const { BookCoupon } = await import('../app/modules/bookCoupon/bookCoupon.model');
  const { User } = await import('../app/modules/user/user.model');

  const api = () => request(app);

  const dmc = await MedicalCollege.create({
    name: 'Dhaka Medical College',
    searchKey: 'dhaka medical college',
    type: 'government',
    division: 'ঢাকা',
    district: 'ঢাকা',
  });

  const registerLogin = async (email: string, device: string, role?: string) => {
    await api().post('/api/auth/register').send({
      firstName: 'T',
      lastName: 'U',
      email,
      password: 'pass1234',
      whatsappNumber: '01712345678',
    });
    if (role) await User.updateOne({ email }, { role });
    const res = await api()
      .post('/api/auth/login')
      .set('x-device-id', device)
      .send({ email, password: 'pass1234' });
    return res.body?.data?.accessToken as string;
  };

  const admin = await registerLogin('amb-admin@test.com', 'ad1', 'superAdmin');

  const applyBody = (over: Record<string, unknown> = {}) => ({
    fullName: 'Md Sakib Hasan',
    phone: '01711112233',
    whatsapp: '01711112233',
    email: 'sakib@test.com',
    facebookUrl: 'https://facebook.com/sakib',
    medicalCollege: String(dmc._id),
    medicalCollegeName: 'Dhaka Medical College',
    batch: 'DMC-K75',
    academicYear: '3rd Year',
    city: 'Dhaka',
    reach: '100-200',
    promoteChannels: ['facebook-groups', 'classmates'],
    isGroupAdmin: true,
    hasPriorExperience: false,
    comfortableSharingContent: true,
    agreement: AGREEMENT,
    ...over,
  });

  // ───────────────────────────────────────────────────────────
  console.log('\n── The abbreviation the code is built from ──');
  {
    // A row created now gets its abbreviation from the schema hook.
    const college: any = await MedicalCollege.findById(dmc._id).lean();
    check(college.abbreviation === 'DMC', `"Dhaka Medical College" → DMC (got ${college.abbreviation})`);
    check(college.abbreviationSource === 'derived', 'and is marked as a guess, not fact');

    // The 112 rows already in production were written before the field existed,
    // so they have none. Reproduced through the raw driver, because going
    // through the model would run the hook and hand us a row that is not the
    // one the backfill has to fix.
    const legacy = await MedicalCollege.create({
      name: 'Rajshahi Medical College',
      searchKey: 'rajshahi medical college',
      type: 'government',
      division: 'রাজশাহী',
      district: 'রাজশাহী',
    });
    await MedicalCollege.collection.updateOne(
      { _id: legacy._id },
      { $unset: { abbreviation: '', abbreviationSource: '' } }
    );

    const filled = await MedicalCollegeService.backfillAbbreviations();
    check(filled === 1, `backfill filled the row that had none (${filled})`);
    const fixed: any = await MedicalCollege.findById(legacy._id).lean();
    check(fixed.abbreviation === 'RMC', `"Rajshahi Medical College" → RMC (got ${fixed.abbreviation})`);

    // Running it again must not touch a row that already has one.
    check((await MedicalCollegeService.backfillAbbreviations()) === 0, 'backfill is idempotent');

    // An admin typing one makes it official, and a later name edit must not
    // overwrite it.
    await MedicalCollegeService.update(String(dmc._id), { abbreviation: 'DMC' } as any);
    const after: any = await MedicalCollege.findById(dmc._id).lean();
    check(after.abbreviationSource === 'official', 'an admin-typed abbreviation becomes official');
  }

  console.log('\n── Applying is public, and always lands as pending ──');
  let appId = '';
  {
    const r = await api().post('/api/ambassador/apply').send(applyBody());
    check(r.status === 201, `no login needed to apply (${r.status})`, r.body?.message);
    check(r.body?.data?.applicationId === 'MVA-AMB-0001', `numbered MVA-AMB-0001 (${r.body?.data?.applicationId})`);
    check(r.body?.data?.status === 'pending', 'status is pending');

    const doc: any = await AmbassadorApplication.findOne({ email: 'sakib@test.com' }).lean();
    appId = String(doc._id);
    check(doc.collegeAbbreviation === 'DMC', 'the college abbreviation is snapshotted onto it');
    check(!!doc.agreedAt, 'the agreement is timestamped');
    check(!doc.couponCode, 'no coupon exists yet');
    check((await BookCoupon.countDocuments({})) === 0, 'and none was created anywhere');
  }

  console.log('\n── What the form may not decide ──');
  {
    // A forged body naming its own status and payout. Everything money-related
    // is a constant in the service, so none of it can land.
    const r = await api()
      .post('/api/ambassador/apply')
      .send(
        applyBody({
          email: 'forger@test.com',
          status: 'approved',
          couponCode: 'FREEBOOK',
          payoutPerSale: 5000,
        })
      );
    check(r.status === 201, 'the forged application still submits');
    const doc: any = await AmbassadorApplication.findOne({ email: 'forger@test.com' }).lean();
    check(doc.status === 'pending', `status forced to pending (got ${doc.status})`);
    check(!doc.couponCode, 'a client-sent coupon code is ignored');
  }

  console.log('\n── Six boxes, not four ──');
  {
    const r = await api()
      .post('/api/ambassador/apply')
      .send(applyBody({ email: 'partial@test.com', agreement: { ...AGREEMENT, noFalseClaims: false } }));
    check(r.status >= 400, `an unticked term is refused (${r.status})`);
  }

  console.log('\n── One live application per person ──');
  {
    const r = await api().post('/api/ambassador/apply').send(applyBody());
    check(r.status === 400, `a second application on the same email is refused (${r.status})`);
    check(
      String(r.body?.message || '').includes('MVA-AMB-0001'),
      'and the refusal quotes their existing application id'
    );
  }

  console.log('\n── Approving mints the coupon and the login ──');
  {
    const r = await api()
      .patch(`/api/ambassador/${appId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' });
    check(r.status === 200, `approved (${r.status})`, r.body?.message);

    const doc: any = await AmbassadorApplication.findById(appId).lean();
    check(doc.status === 'approved', 'application is approved');
    check(doc.couponCode === 'DMCSAKIB20', `code is DMCSAKIB20 (got ${doc.couponCode})`);

    const coupon: any = await BookCoupon.findOne({ code: 'DMCSAKIB20' }).lean();
    check(coupon.isActive === true, 'the coupon is live');
    check(coupon.discountType === 'fixed' && coupon.discountValue === 20, '৳20 off the buyer');
    check(coupon.payoutPerSale === 30, '৳30 to the ambassador per sale');
    check(String(coupon.ownerUser) === String(doc.user), 'the coupon belongs to their account');

    const user: any = await User.findById(doc.user).select('+password').lean();
    check(user.role === 'affiliate', 'they get the affiliate role');
    check(user.isPasswordChanged === false, 'and are flagged to change their password');
  }

  console.log('\n── Email is the id, phone is the first password ──');
  {
    const r = await api()
      .post('/api/auth/login')
      .set('x-device-id', 'amb1')
      .send({ email: 'sakib@test.com', password: '01711112233' });
    check(r.status === 200, `the ambassador can sign in with their phone number (${r.status})`, r.body?.message);
    check(r.body?.data?.accessToken, 'and gets a token');
    // The dashboard opens its change-password card on this. It was being
    // written at signup and never returned, so nothing could act on it.
    check(
      r.body?.data?.user?.isPasswordChanged === false,
      'and is told the password is still the one chosen for them'
    );
  }

  console.log('\n── …and can change it themselves ──');
  {
    const login = async (password: string, device: string) =>
      api().post('/api/auth/login').set('x-device-id', device).send({ email: 'sakib@test.com', password });

    const first = await login('01711112233', 'amb-pw1');
    const token = first.body?.data?.accessToken;

    const wrong = await api()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not-their-phone', newPassword: 'brandnew123' });
    check(wrong.status >= 400, `the wrong current password is refused (${wrong.status})`);

    const ok = await api()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: '01711112233', newPassword: 'brandnew123' });
    check(ok.status === 200, `changed (${ok.status})`, ok.body?.message);

    const old = await login('01711112233', 'amb-pw2');
    check(old.status >= 400, `the phone number no longer signs them in (${old.status})`);

    const fresh = await login('brandnew123', 'amb-pw3');
    check(fresh.status === 200, `the new password does (${fresh.status})`, fresh.body?.message);
    // Without this the dashboard would keep telling them to change a password
    // they have already changed.
    check(
      fresh.body?.data?.user?.isPasswordChanged === true,
      'and the "still on the default" flag is finally cleared'
    );
  }

  console.log('\n── A second Sakib at the same college ──');
  {
    await api()
      .post('/api/ambassador/apply')
      .send(applyBody({ email: 'sakib2@test.com', phone: '01799887766', fullName: 'Sakib Ahmed' }));
    const doc2: any = await AmbassadorApplication.findOne({ email: 'sakib2@test.com' }).lean();
    const r = await api()
      .patch(`/api/ambassador/${doc2._id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' });
    check(r.status === 200, 'the second Sakib is approved too');

    const after: any = await AmbassadorApplication.findById(doc2._id).lean();
    check(after.couponCode !== 'DMCSAKIB20', `gets a different code (${after.couponCode})`);
    check(
      after.couponCode.startsWith('DMCSAKIB20'),
      'that is still recognisably theirs (same base, own tail)'
    );
    check(
      after.couponCode.endsWith('66'),
      `built from their own phone number, not a random string (${after.couponCode})`
    );
  }

  console.log('\n── Suspending takes the coupon offline, keeps the record ──');
  {
    const r = await api()
      .patch(`/api/ambassador/${appId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'suspended', adminNote: 'misused the code' });
    check(r.status === 200, 'suspended');

    const coupon: any = await BookCoupon.findOne({ code: 'DMCSAKIB20' }).lean();
    check(coupon.isActive === false, 'the coupon stops working');
    check(!!coupon, 'but the coupon row is kept — past orders still reference it');

    const doc: any = await AmbassadorApplication.findById(appId).lean();
    check(doc.adminNote === 'misused the code', 'the reviewer note is saved');
    check(doc.couponCode === 'DMCSAKIB20', 'the application keeps its code');
  }

  console.log('\n── Re-approving must not issue a second code ──');
  {
    await api()
      .patch(`/api/ambassador/${appId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' });

    const doc: any = await AmbassadorApplication.findById(appId).lean();
    const coupon: any = await BookCoupon.findById(doc.coupon).lean();
    check(doc.couponCode === 'DMCSAKIB20', 'the same code comes back');
    check(coupon.isActive === true, 'and is live again');
    check(
      (await BookCoupon.countDocuments({ ownerUser: doc.user })) === 1,
      'exactly one coupon exists for them — a second would orphan past orders'
    );
  }

  console.log('\n── Reviewing is staff-only ──');
  {
    const outsider = await registerLogin('nosy@test.com', 'ns1');
    const anon = await api().get('/api/ambassador');
    const asUser = await api().get('/api/ambassador').set('Authorization', `Bearer ${outsider}`);
    check(anon.status === 401, `the queue is closed to the public (${anon.status})`);
    check(asUser.status === 403, `and to a signed-in student (${asUser.status})`);

    const approve = await api()
      .patch(`/api/ambassador/${appId}/status`)
      .set('Authorization', `Bearer ${outsider}`)
      .send({ status: 'approved' });
    check(approve.status === 403, `a student cannot approve themselves (${approve.status})`);
  }

  console.log('\n── An ID card is not a public file ──');
  {
    await AmbassadorApplication.updateOne(
      { _id: appId },
      { $set: { idCardUrl: 'https://x.test/api/ambassador/id-card/1700000000-id.jpg' } }
    );
    const anon = await api().get('/api/ambassador/id-card/1700000000-id.jpg');
    check(anon.status === 401, `anonymous request refused (${anon.status})`);

    const outsider = await registerLogin('other@test.com', 'ot1');
    const asOther = await api()
      .get('/api/ambassador/id-card/1700000000-id.jpg')
      .set('Authorization', `Bearer ${outsider}`);
    check(asOther.status === 403, `another signed-in user refused (${asOther.status})`);

    // Staff get past the access check — the 404 below is the file not being on
    // this machine, which is the NEXT check, and means they were allowed.
    const asAdmin = await api()
      .get('/api/ambassador/id-card/1700000000-id.jpg')
      .set('Authorization', `Bearer ${admin}`);
    check(asAdmin.status === 404, `staff pass the access check (${asAdmin.status}, file absent)`);
  }

  console.log('\n── The admin table adds up ──');
  {
    const r = await api().get('/api/ambassador').set('Authorization', `Bearer ${admin}`);
    check(r.status === 200, 'the queue loads');
    check(Array.isArray(r.body?.data), 'it returns rows');
    const row = r.body.data.find((x: any) => x.applicationId === 'MVA-AMB-0001');
    check(!!row, 'the first ambassador is in it');
    check(row?.stats?.orders === 0, 'with no sales yet');
    check(r.body?.counts?.approved >= 2, `and the status counts are there (${JSON.stringify(r.body?.counts)})`);
  }

  // ───────────────────────────────────────────────────────────
  // The half that turns the programme into money: someone buys the book with
  // an ambassador's code, and the ৳30 has to reach the right person, once, and
  // only for a sale that actually happened.
  // ───────────────────────────────────────────────────────────
  console.log('\n── A student buys with the code ──');
  const { Book } = await import('../app/modules/book/book.model');
  const { Order } = await import('../app/modules/order/order.model');
  const book = await Book.create({
    id: 1,
    title: 'Anatomy MAGIC VIVA',
    slug: 'anatomy-magic-viva',
    price: 500,
    author: 'Sabbir',
    category: 'medical',
    description: 'test',
    format: 'printed',
    stock: 100,
  });

  const buyer = await registerLogin('buyer-amb@test.com', 'by1');
  await User.updateOne(
    { email: 'buyer-amb@test.com' },
    { medicalCollegeName: 'Dhaka Medical College' }
  );

  let orderId = '';
  {
    const r = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyer}`)
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        shippingAddress: { name: 'B', phone: '01700000000', address: 'Rd', city: 'Dhaka' },
        paymentMethod: 'cod',
        couponCode: 'DMCSAKIB20',
      });
    check(r.status === 201 || r.status === 200, `order placed with the code (${r.status})`, r.body?.message);
    orderId = r.body?.data?._id;

    const o: any = await Order.findById(orderId).lean();
    check(o.couponCode === 'DMCSAKIB20', `the code is snapshotted onto the order (${o.couponCode})`);
    check(o.couponDiscount === 20, `৳20 came off the buyer (got ৳${o.couponDiscount})`);
    check(
      o.couponPayout === 30,
      `৳30 is owed to the ambassador, snapshotted (got ৳${o.couponPayout})`
    );
    check(o.subtotal - o.discount + o.deliveryCharge === o.total, 'and the total adds up');
  }

  console.log('\n── Editing the coupon later must not rewrite a past order ──');
  {
    await BookCoupon.updateOne({ code: 'DMCSAKIB20' }, { $set: { payoutPerSale: 999 } });
    const o: any = await Order.findById(orderId).lean();
    check(o.couponPayout === 30, `the placed order still owes ৳30, not ৳999 (got ৳${o.couponPayout})`);
    await BookCoupon.updateOne({ code: 'DMCSAKIB20' }, { $set: { payoutPerSale: 30 } });
  }

  console.log('\n── An unpaid, undelivered sale is not earned yet ──');
  {
    // Real money only. The admin table and the payout report both filter on the
    // same "delivered or paid" test the revenue figures use.
    const r = await api().get('/api/ambassador').set('Authorization', `Bearer ${admin}`);
    const row = r.body.data.find((x: any) => x.couponCode === 'DMCSAKIB20');
    check(row?.stats?.orders === 0, `a pending COD order counts 0 orders (got ${row?.stats?.orders})`);
    check(row?.stats?.commission === 0, `and ৳0 commission (got ৳${row?.stats?.commission})`);
  }

  console.log('\n── Delivered — now it counts ──');
  {
    await api()
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'delivered' });

    const r = await api().get('/api/ambassador').set('Authorization', `Bearer ${admin}`);
    const row = r.body.data.find((x: any) => x.couponCode === 'DMCSAKIB20');
    check(row?.stats?.orders === 1, `1 order (got ${row?.stats?.orders})`);
    check(row?.stats?.commission === 30, `৳30 commission (got ৳${row?.stats?.commission})`);
    check(row?.stats?.sales > 0, `and the sale value is counted (৳${row?.stats?.sales})`);
  }

  console.log('\n── The ambassador sees the same numbers ──');
  {
    // 'brandnew123', not their phone number: the change-password case above
    // already moved them off the default, which is the whole point of it.
    const amb = await api()
      .post('/api/auth/login')
      .set('x-device-id', 'amb2')
      .send({ email: 'sakib@test.com', password: 'brandnew123' });
    const token = amb.body?.data?.accessToken;

    const r = await api().get('/api/book-coupons/my').set('Authorization', `Bearer ${token}`);
    check(r.status === 200, `their own dashboard loads (${r.status})`, r.body?.message);
    check(r.body?.data?.totals?.sales === 1, `1 sale on their dashboard (got ${r.body?.data?.totals?.sales})`);
    check(
      r.body?.data?.totals?.earned === 30,
      `৳30 earned on their dashboard (got ৳${r.body?.data?.totals?.earned})`
    );
  }

  console.log('\n── And the payout report owes it ──');
  {
    const r = await api().get('/api/book-coupons/payouts').set('Authorization', `Bearer ${admin}`);
    check(r.status === 200, `the payout report loads (${r.status})`);
    const body = JSON.stringify(r.body);
    check(body.includes('DMCSAKIB20'), 'the ambassador is in it');
  }

  console.log('\n── Suspending stops the code at the checkout ──');
  {
    await api()
      .patch(`/api/ambassador/${appId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'suspended' });

    const r = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyer}`)
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        shippingAddress: { name: 'B', phone: '01700000000', address: 'Rd', city: 'Dhaka' },
        paymentMethod: 'cod',
        couponCode: 'DMCSAKIB20',
      });
    check(r.status >= 400, `a suspended ambassador's code is refused (${r.status})`);

    // The sale they already made is still theirs — suspension is not clawback.
    const q = await api().get('/api/ambassador?status=all').set('Authorization', `Bearer ${admin}`);
    const row = q.body.data.find((x: any) => x.couponCode === 'DMCSAKIB20');
    check(row?.stats?.commission === 30, `their earned ৳30 survives suspension (got ৳${row?.stats?.commission})`);
  }

  // ───────────────────────────────────────────────────────────
  // Managing affiliates from the admin panel: add someone who never applied,
  // edit everything about them, and remove them.
  // ───────────────────────────────────────────────────────────
  console.log('\n── Adding an affiliate by hand ──');
  let manualId = '';
  {
    const r = await api()
      .post('/api/ambassador')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        fullName: 'Nusrat Jahan',
        phone: '01555667788',
        email: 'nusrat@test.com',
        medicalCollege: String(dmc._id),
        // Deliberately none of the form-only fields — an admin adding a
        // bookseller does not know their batch or how many students they reach.
      });
    check(r.status === 201, `added without an application (${r.status})`, r.body?.message);
    manualId = r.body?.data?._id;

    const doc: any = await AmbassadorApplication.findById(manualId).lean();
    check(doc.source === 'manual', `marked as added by hand (got '${doc.source}')`);
    check(doc.status === 'approved', 'approved straight away — an admin typing them in IS the approval');
    check(doc.couponCode === 'DMCNUSRAT20', `built from their college: DMCNUSRAT20 (got ${doc.couponCode})`);
    check(doc.couponCode !== 'DMCSAKIB20', 'a different one from the Sakib who already has that code');

    const coupon: any = await BookCoupon.findOne({ code: doc.couponCode }).lean();
    check(coupon.isActive === true, 'live');
    check(coupon.discountValue === 20 && coupon.payoutPerSale === 30, 'on the same ৳20 / ৳30 terms');

    const login = await api()
      .post('/api/auth/login')
      .set('x-device-id', 'manual1')
      .send({ email: 'nusrat@test.com', password: '01555667788' });
    check(login.status === 200, `and can sign in with their phone number (${login.status})`);
  }

  console.log('\n── Editing everything about them ──');
  {
    const r = await api()
      .patch(`/api/ambassador/${manualId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({
        fullName: 'Nusrat Jahan Mim',
        phone: '01555660000',
        city: 'Khulna',
        batch: 'DMC-K76',
        adminNote: 'sells at the college gate',
      });
    check(r.status === 200, `edited (${r.status})`, r.body?.message);

    const doc: any = await AmbassadorApplication.findById(manualId).lean();
    check(doc.fullName === 'Nusrat Jahan Mim', 'name updated');
    check(doc.city === 'Khulna' && doc.batch === 'DMC-K76', 'and the fields an admin left blank can be filled in later');

    // The person's own login has to follow, or an order alert prints a name the
    // admin has just corrected.
    const user: any = await User.findById(doc.user).lean();
    check(user.firstName === 'Nusrat', `their login's name follows (got ${user.firstName})`);
    check(user.phoneNumber === '01555660000', 'and their phone number');
  }

  console.log('\n── What editing must NOT touch ──');
  {
    const before: any = await AmbassadorApplication.findById(manualId).lean();
    const r = await api()
      .patch(`/api/ambassador/${manualId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'rejected', couponCode: 'FREEBOOK', applicationId: 'MVA-AMB-9999' });
    check(r.status === 200, 'the request is accepted');

    const after: any = await AmbassadorApplication.findById(manualId).lean();
    check(after.status === before.status, `status is not editable here (still '${after.status}')`);
    check(after.couponCode === before.couponCode, 'nor the coupon code');
    check(after.applicationId === before.applicationId, 'nor the application id');
  }

  console.log('\n── An email already in use is refused ──');
  {
    const r = await api()
      .patch(`/api/ambassador/${manualId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'sakib@test.com' });
    check(r.status === 400, `refused (${r.status})`);
  }

  console.log('\n── The coupon screen tells the two kinds of code apart ──');
  {
    // A plain shop coupon: a discount the shop is running, belonging to nobody.
    const made = await api()
      .post('/api/book-coupons')
      .set('Authorization', `Bearer ${admin}`)
      .send({ code: 'BOIMELA25', name: 'বইমেলা ছাড়', discountType: 'percent', discountValue: 25 });
    check(made.status === 201, `a plain coupon is created (${made.status})`, made.body?.message);
    const plainId = String(made.body?.data?._id);

    const list = await api().get('/api/book-coupons').set('Authorization', `Bearer ${admin}`);
    check(list.status === 200, `the list loads (${list.status})`);

    const rows: any[] = list.body?.data || [];
    const plain = rows.find((c) => c.code === 'BOIMELA25');
    const owned = rows.find((c) => c.code === 'DMCSAKIB20');

    check(plain?.affiliate === null, 'a shop coupon is marked as belonging to nobody');
    check(!!owned?.affiliate, "an affiliate's code says so");
    check(
      owned?.affiliate?.fullName === 'Md Sakib Hasan',
      `and names the person (got ${owned?.affiliate?.fullName})`
    );
    check(
      /^MVA-AMB-\d{4}$/.test(owned?.affiliate?.applicationId || ''),
      'with the application id the affiliate screen is keyed by'
    );

    // The plain one is the shop's to throw away.
    const gone = await api()
      .delete(`/api/book-coupons/${plainId}`)
      .set('Authorization', `Bearer ${admin}`);
    check(gone.status === 200, `a shop coupon can be deleted here (${gone.status})`);

    // The affiliate's is not: their earnings are counted from orders carrying it.
    const refused = await api()
      .delete(`/api/book-coupons/${String(owned._id)}`)
      .set('Authorization', `Bearer ${admin}`);
    check(refused.status === 409, `an affiliate's code is refused (${refused.status})`);
    check(
      String(refused.body?.message || '').includes('Md Sakib Hasan'),
      'and the refusal says whose it is'
    );
    check(
      !!(await BookCoupon.findOne({ code: 'DMCSAKIB20' }).lean()),
      'so the code — and their earnings history — survives'
    );
  }

  console.log('\n── Removing an affiliate keeps what the shop owes ──');
  {
    const doc: any = await AmbassadorApplication.findById(manualId).lean();
    const code = doc.couponCode;

    const r = await api()
      .delete(`/api/ambassador/${manualId}`)
      .set('Authorization', `Bearer ${admin}`);
    check(r.status === 200, `removed (${r.status})`, r.body?.message);
    check((await AmbassadorApplication.countDocuments({ _id: manualId })) === 0, 'the record is gone');

    const coupon: any = await BookCoupon.findOne({ code }).lean();
    check(!!coupon, 'but the coupon row is KEPT — past orders reference it');
    check(coupon.isActive === false, 'switched off, so nobody can use it again');

    const user: any = await User.findById(doc.user).lean();
    check(user.status === 'blocked', 'and their login is blocked rather than deleted');
  }

  console.log('\n── Removing is not something every reviewer may do ──');
  {
    const outsider = await registerLogin('nodelete@test.com', 'nd1');
    const r = await api()
      .delete(`/api/ambassador/${String((await AmbassadorApplication.findOne({}).lean())!._id)}`)
      .set('Authorization', `Bearer ${outsider}`);
    check(r.status === 403, `a student cannot remove an affiliate (${r.status})`);
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
