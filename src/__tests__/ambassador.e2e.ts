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

  // ───────────────────────────────────────────────────────────
  // Narrowing the list. Two people exist by now: Sakib, who applied and has one
  // delivered order under DMCSAKIB20, and Nusrat, whom an admin typed in and
  // who has sold nothing. Every filter below is checked against that pair.
  // ───────────────────────────────────────────────────────────
  const listWith = async (qs: string) => {
    const r = await api().get(`/api/ambassador?${qs}`).set('Authorization', `Bearer ${admin}`);
    return r.body as { data: any[]; facets: any; counts: any };
  };
  const names = (rows: any[]) => rows.map((r) => r.fullName).sort().join(', ');

  console.log('\n── The call name is what the code is built from ──');
  {
    // Guessing gets this wrong often enough to matter: "Md. Tanvir Al Mahmud"
    // guesses MAHMUD (longest non-honorific), but everyone calls him Tanvir.
    // The form asks, and the answer wins.
    const r = await api()
      .post('/api/ambassador')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        fullName: 'Md Tanvir Al Mahmud',
        nickname: 'Tanvir',
        phone: '01999001122',
        email: 'tanvir-nick@test.com',
        medicalCollege: String(dmc._id),
      });
    check(r.status === 201, `added (${r.status})`, r.body?.message);

    const doc: any = await AmbassadorApplication.findById(r.body?.data?._id).lean();
    check(doc.nickname === 'Tanvir', `the call name is kept (${doc.nickname})`);
    check(
      doc.couponCode === 'DMCTANVIR20',
      `code follows the call name: DMCTANVIR20 (got ${doc.couponCode})`
    );
    check(
      doc.couponCode !== 'DMCMAHMUD20',
      'not the longest word, which is what guessing would have picked'
    );
  }

  console.log('\n── With no call name, the guess still runs ──');
  {
    const r = await api()
      .post('/api/ambassador')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        fullName: 'Md Rakib Hossain',
        phone: '01999003344',
        email: 'rakib-noname@test.com',
        medicalCollege: String(dmc._id),
      });
    const doc: any = await AmbassadorApplication.findById(r.body?.data?._id).lean();
    check(
      doc.couponCode === 'DMCHOSSAIN20',
      `falls back to the longest non-honorific word (got ${doc.couponCode})`
    );
  }

  console.log('\n── The dropdowns only offer what exists ──');
  {
    const { facets } = await listWith('status=all');
    check(Array.isArray(facets?.colleges), 'facets come back with the list');
    check(
      facets.colleges.includes('Dhaka Medical College'),
      `colleges are the ones people actually attend (${facets.colleges.join(' | ')})`
    );
    check(
      !facets.colleges.includes('Rajshahi Medical College'),
      'a college nobody signed up from is not offered'
    );
    check(
      facets.divisions.includes('ঢাকা'),
      `divisions come from those colleges (${facets.divisions.join(' | ')})`
    );
    check(
      facets.academicYears.includes('3rd Year'),
      `years are the ones on file (${facets.academicYears.join(' | ')})`
    );
    check(
      !facets.batches.includes(''),
      'and a blank is never offered as a choice'
    );
  }

  console.log('\n── Who is selling, and who is not ──');
  {
    // Note the status: the one person with a sale was suspended earlier in this
    // run. That is exactly why "has sold" and "is approved" are separate
    // filters — money already earned does not disappear when a code is
    // switched off, and the shop still owes it.
    const selling = await listWith('status=all&performance=selling');
    check(selling.data.length === 1, `one person has sold something (${selling.data.length})`);
    check(selling.data[0].couponCode === 'DMCSAKIB20', `and it is Sakib's code (${names(selling.data)})`);
    check(
      selling.data[0].status === 'suspended',
      'a suspended affiliate with earnings is still found — the shop owes them'
    );

    const idle = await listWith('status=all&performance=idle');
    check(
      idle.data.every((r: any) => r.stats.orders === 0),
      `the idle list has no sales in it (${names(idle.data)})`
    );
    check(
      idle.data.some((r: any) => r.fullName === 'Nusrat Jahan Mim'),
      'and Nusrat, signed up but quiet, is in it'
    );
    check(
      idle.data.length + selling.data.length === (await listWith('status=all')).data.length,
      'and the two halves account for everybody'
    );
  }

  console.log('\n── The earnings window moves the numbers, not the roster ──');
  {
    // A window that ends before anything was ordered. The people are still
    // there — they just did nothing in that window.
    const past = await listWith('status=all&from=2000-01-01&to=2000-12-31');
    const sakib = past.data.find((r: any) => r.couponCode === 'DMCSAKIB20');
    check(!!sakib, 'Sakib is still listed for a window he sold nothing in');
    check(sakib.stats.orders === 0, `with 0 orders in that window (got ${sakib.stats.orders})`);
    check(sakib.stats.commission === 0, `and ৳0 owed for it (got ৳${sakib.stats.commission})`);

    // And the performance filter reads the window too, which is the point of it.
    const sellingThen = await listWith('status=all&from=2000-01-01&to=2000-12-31&performance=selling');
    check(sellingThen.data.length === 0, `nobody sold anything in 2000 (${sellingThen.data.length})`);
  }

  console.log('\n── Who joined when ──');
  {
    const old = await listWith('status=all&joinedTo=2000-01-01');
    check(old.data.length === 0, `nobody joined before 2000 (${old.data.length})`);

    const recent = await listWith('status=all&joinedFrom=2020-01-01');
    check(recent.data.length > 0, `but everyone joined after 2020 (${recent.data.length})`);
  }

  console.log('\n── How they got here ──');
  {
    const manual = await listWith('status=all&source=manual');
    check(
      manual.data.every((r: any) => r.source === 'manual'),
      `only admin-added people (${names(manual.data)})`
    );
    check(manual.data.some((r: any) => r.fullName === 'Nusrat Jahan Mim'), 'Nusrat is one of them');

    const applied = await listWith('status=all&source=application');
    check(
      applied.data.every((r: any) => r.source !== 'manual'),
      'and the other way round keeps them out'
    );
  }

  console.log('\n── College, division and year ──');
  {
    const byCollege = await listWith('status=all&college=Dhaka%20Medical%20College');
    check(byCollege.data.length > 0, `the college filter finds people (${byCollege.data.length})`);
    check(
      byCollege.data.every((r: any) => r.medicalCollegeName === 'Dhaka Medical College'),
      'and only that college'
    );

    // Division lives on the college, not the person — it is resolved through it.
    const byDivision = await listWith('status=all&division=' + encodeURIComponent('ঢাকা'));
    check(byDivision.data.length > 0, `division resolves through the college (${byDivision.data.length})`);

    const byYear = await listWith('status=all&academicYear=3rd%20Year');
    check(
      byYear.data.every((r: any) => r.academicYear === '3rd Year'),
      `year filters exactly (${names(byYear.data)})`
    );
    check(
      !byYear.data.some((r: any) => r.fullName === 'Nusrat Jahan Mim'),
      'so the admin-added person with no year set is left out'
    );
  }

  console.log('\n── The coupon switch is asked of the coupon ──');
  {
    // Someone approved, whose code an admin turned off from the coupon screen.
    // Their status still says approved, so only the coupon knows.
    await BookCoupon.updateOne({ code: 'DMCNUSRAT20' }, { $set: { isActive: false } });

    const off = await listWith('status=approved&coupon=inactive');
    check(
      off.data.some((r: any) => r.couponCode === 'DMCNUSRAT20'),
      `a switched-off code is found even though the person is approved (${names(off.data)})`
    );

    const on = await listWith('status=approved&coupon=active');
    check(
      !on.data.some((r: any) => r.couponCode === 'DMCNUSRAT20'),
      'and is not in the live list'
    );
    await BookCoupon.updateOne({ code: 'DMCNUSRAT20' }, { $set: { isActive: true } });
  }

  console.log('\n── Sorting ──');
  {
    const byCommission = await listWith('status=all&sort=commission');
    check(
      byCommission.data[0]?.fullName === 'Md Sakib Hasan',
      `the biggest earner is first (${byCommission.data[0]?.fullName})`
    );

    const byName = await listWith('status=all&sort=name');
    const sorted = [...byName.data.map((r: any) => r.fullName)].sort((a, b) => a.localeCompare(b));
    check(
      JSON.stringify(byName.data.map((r: any) => r.fullName)) === JSON.stringify(sorted),
      `by name is actually alphabetical (${byName.data.map((r: any) => r.fullName).join(' | ')})`
    );
  }

  console.log('\n── Searching reaches more than the name ──');
  {
    // A partial code matches, which is the point — the shop types what it can
    // read off a screenshot. DMCSAKIB20 also matches DMCSAKIB2066.
    const byCode = await listWith('status=all&q=DMCSAKIB20');
    check(byCode.data.length >= 1, `by coupon code (${byCode.data.length})`);
    check(
      byCode.data.every((r: any) => r.couponCode.includes('DMCSAKIB20')),
      'and only codes that contain what was typed'
    );

    const byPhone = await listWith('status=all&q=01711112233');
    check(byPhone.data.length >= 1, `by phone number (${byPhone.data.length})`);

    const byId = await listWith('status=all&q=MVA-AMB-0001');
    check(byId.data.length === 1, `by application id (${byId.data.length})`);

    check((await listWith('status=all&q=Chittagong')).data.length === 0, 'a college nobody is at finds nobody');
    check((await listWith('status=all&q=Dhaka%20Medical')).data.length > 0, 'and by college name');
  }

  console.log('\n── Two filters together narrow, not widen ──');
  {
    const both = await listWith('status=all&source=application&performance=selling');
    check(both.data.length === 1, `applied AND selling is one person (${both.data.length})`);
    const impossible = await listWith('status=all&source=manual&performance=selling');
    check(impossible.data.length === 0, 'admin-added AND selling is nobody, so far');
  }

  console.log('\n── The detail panel shows the orders behind the number ──');
  {
    const sakib: any = await AmbassadorApplication.findOne({ couponCode: 'DMCSAKIB20' }).lean();
    const r = await api()
      .get(`/api/ambassador/${String(sakib._id)}`)
      .set('Authorization', `Bearer ${admin}`);
    check(r.status === 200, `the detail loads (${r.status})`);

    const d = r.body.data;
    check(Array.isArray(d.orders), 'it carries the orders list');
    check(d.orders.length === 1, `the one delivered order is in it (${d.orders.length})`);
    check(d.orders[0].couponPayout === 30, `carrying its own ৳30 snapshot (got ৳${d.orders[0]?.couponPayout})`);
    check(
      d.orders.reduce((n: number, o: any) => n + (o.couponPayout || 0), 0) === d.stats.commission,
      'and the listed orders add up to the commission shown'
    );
    check(Array.isArray(d.notCounted), 'the orders that did NOT count are listed too');
    check(!!d.user?.email, `their login is included (${d.user?.email})`);
    check(!d.user?.password, 'but never a password');
    check(!!d.medicalCollege?.division, 'and the college is populated, so division shows');
  }

  console.log('\n── An unpaid order is shown, and shown as not counted ──');
  {
    // Nusrat's code, because it is the live one — a suspended affiliate's code
    // is refused at checkout, which is the whole point of suspending them.
    const buyer2 = await registerLogin('buyer2-amb@test.com', 'by2');
    await User.updateOne(
      { email: 'buyer2-amb@test.com' },
      { medicalCollegeName: 'Dhaka Medical College' }
    );
    const placed = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyer2}`)
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        shippingAddress: { name: 'C', phone: '01700000001', address: 'Rd', city: 'Dhaka' },
        paymentMethod: 'cod',
        couponCode: 'DMCNUSRAT20',
        medicalCollegeName: 'Dhaka Medical College',
      });
    check(placed.status === 201 || placed.status === 200, `a COD order is placed (${placed.status})`, placed.body?.message);

    const nusrat: any = await AmbassadorApplication.findOne({ couponCode: 'DMCNUSRAT20' }).lean();
    const d = (
      await api().get(`/api/ambassador/${String(nusrat._id)}`).set('Authorization', `Bearer ${admin}`)
    ).body.data;

    check(d.stats.orders === 0, `she has earned nothing yet (got ${d.stats.orders} counted orders)`);
    check(d.orders.length === 0, 'so the earning list is empty');
    check(d.notCounted.length === 1, `but the pending order is shown (${d.notCounted.length})`);
    check(
      d.notCounted[0].couponCode === 'DMCNUSRAT20',
      'under her code — so "1 person used my code, ৳0 earned" explains itself'
    );

    // And once it is delivered, it moves across on its own.
    await api()
      .patch(`/api/orders/${placed.body?.data?._id}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'delivered' });

    const after = (
      await api().get(`/api/ambassador/${String(nusrat._id)}`).set('Authorization', `Bearer ${admin}`)
    ).body.data;
    check(after.stats.orders === 1, `delivered — now it counts (${after.stats.orders})`);
    check(after.notCounted.length === 0, 'and it has left the not-counted list');
    check(after.stats.commission === 30, `৳30 owed to her (got ৳${after.stats.commission})`);
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
