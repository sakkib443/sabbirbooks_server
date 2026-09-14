/* eslint-disable no-console */
/**
 * What a parcel costs to send (isolated in-memory MongoDB, real Express app via
 * supertest; never the live DB).
 *
 *   free-above  the order crosses Settings.freeDeliveryAbove
 *   college     the buyer's college has its own rate, AND the parcel goes to that
 *               college's own district and upazila
 *   standard    everything else — Settings.deliveryCharge
 *
 * The shop sometimes delivers to a campus itself, so a college can be given a
 * cheaper rate. The rate is for delivering THERE: a Rajshahi Medical College
 * student whose book goes home to Narail pays the standard charge. That is the
 * case worth testing, along with the two Khulna rules this replaced (a free
 * college, a cheaper town), which now live on the college rows.
 *
 * Run:  npx ts-node src/__tests__/delivery-tiers.e2e.ts
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
  // Dozens of guest orders from 127.0.0.1 in a few seconds.
  process.env.ORDER_CREATE_LIMIT = '1000';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Book } = await import('../app/modules/book/book.model');
  const { User } = await import('../app/modules/user/user.model');
  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const { MedicalCollegeService } = await import(
    '../app/modules/medicalCollege/medicalCollege.service'
  );
  const { Settings } = await import('../app/modules/settings/settings.model');
  const { collegeRateApplies } = await import('../app/modules/order/order.service');

  const api = () => request(app);

  await Settings.create({ deliveryCharge: 120, codExtraCharge: 0, freeDeliveryAbove: 0 } as any);

  const mkCollege = (
    name: string,
    district: string,
    division: string,
    upazila: string,
    deliveryCharge: number | null,
    type = 'private'
  ) =>
    MedicalCollege.create({
      name, searchKey: name.toLowerCase(), type, division, district, upazila, deliveryCharge,
    });

  const kmc = await mkCollege('Khulna Medical College', 'খুলনা', 'খুলনা', 'খুলনা সদর', 0, 'government');
  const gazi = await mkCollege('Gazi Medical College', 'খুলনা', 'খুলনা', 'খুলনা সদর', 100);
  const rmc = await mkCollege('Rajshahi Medical College', 'রাজশাহী', 'রাজশাহী', 'রাজপাড়া', 60, 'government');
  const dmc = await mkCollege('Dhaka Medical College', 'ঢাকা', 'ঢাকা', 'শাহবাগ', null, 'government');
  const noUpazila = await mkCollege('Somewhere Medical College', 'যশোর', 'খুলনা', '', 50);

  await Book.create({
    id: 1, title: 'Anatomy MAGIC VIVA', slug: 'anatomy-magic-viva',
    price: 500, author: 'Sabbir', category: 'medical', description: 'test',
    format: 'printed', stock: 500,
  });

  // Each guest order gets its own number, so the double-order guard never
  // mistakes these for repeats.
  let n = 0;
  const quote = async (
    college: any,
    geo: { division: string; district: string; upazila: string },
    extra: Record<string, unknown> = {}
  ) => {
    n += 1;
    const r = await api()
      .post('/api/orders')
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        shippingAddress: {
          name: 'B', phone: `0171${String(1000000 + n).slice(-7)}`, address: 'Rd 5',
          city: geo.upazila, ...geo,
        },
        paymentMethod: 'cod',
        ...(college ? { medicalCollege: String(college._id) } : {}),
        ...extra,
      });
    return {
      charge: r.body?.data?.deliveryCharge,
      rule: r.body?.data?.deliveryRule,
      status: r.status,
      msg: r.body?.message,
      body: r.body?.data,
    };
  };

  const KHULNA = { division: 'খুলনা', district: 'খুলনা', upazila: 'খুলনা সদর' };

  console.log('\n── A college with a rate, parcel going to the college ──');
  {
    const k = await quote(kmc, KHULNA);
    check(k.charge === 0 && k.rule === 'college', `Khulna Medical College → ৳0, rule college (got ৳${k.charge}, ${k.rule})`, k.msg);

    const g = await quote(gazi, KHULNA);
    check(g.charge === 100 && g.rule === 'college', `Gazi Medical College → ৳100 (got ৳${g.charge})`, g.msg);

    const r = await quote(rmc, { division: 'রাজশাহী', district: 'রাজশাহী', upazila: 'রাজপাড়া' });
    check(r.charge === 60, `Rajshahi Medical College, parcel to রাজপাড়া → ৳60 (got ৳${r.charge})`, r.msg);
  }

  console.log('\n── Same college, parcel going somewhere else ──');
  {
    // The shop's own example: a Rajshahi student ordering from Narail.
    const narail = await quote(rmc, { division: 'খুলনা', district: 'নড়াইল', upazila: 'নড়াইল সদর' });
    check(
      narail.charge === 120 && narail.rule === 'standard',
      `a Rajshahi Medical College student shipping to Narail pays ৳120 (got ৳${narail.charge})`,
      narail.msg
    );

    // Right district, wrong upazila — both halves have to match.
    const dumuria = await quote(gazi, { division: 'খুলনা', district: 'খুলনা', upazila: 'ডুমুরিয়া' });
    check(dumuria.charge === 120, `Gazi student, Khulna district but ডুমুরিয়া → ৳120 (got ৳${dumuria.charge})`);

    // The old rule followed the college anywhere. This one does not.
    const home = await quote(gazi, { division: 'বরিশাল', district: 'বরিশাল', upazila: 'বরিশাল সদর' });
    check(home.charge === 120, `Gazi student sending the book home to Barishal → ৳120 (got ৳${home.charge})`);

    // And a Dhaka student typing a Khulna address does not borrow Gazi's rate.
    const pretend = await quote(dmc, KHULNA);
    check(pretend.charge === 120, `Dhaka Medical College with a Khulna address → ৳120 (got ৳${pretend.charge})`);
  }

  console.log('\n── No rate, no upazila, or no listed college → standard ──');
  {
    const d = await quote(dmc, { division: 'ঢাকা', district: 'ঢাকা', upazila: 'শাহবাগ' });
    check(d.charge === 120 && d.rule === 'standard', `Dhaka Medical College (no rate) → ৳120 (got ৳${d.charge})`);

    // The parcel's address is complete; it is the COLLEGE that has no upazila,
    // so there is nothing for the rate to be matched against.
    const u = await quote(noUpazila, { division: 'খুলনা', district: 'যশোর', upazila: 'যশোর সদর' });
    check(u.charge === 120, `a rate with no upazila on the college never applies → ৳120 (got ৳${u.charge})`, u.msg);

    const typed = await quote(null, KHULNA, { medicalCollegeName: 'A College Not In The List' });
    check(
      typed.status === 201 && typed.charge === 120 && typed.body?.college?.name === 'A College Not In The List',
      `an unlisted college typed by the buyer → order placed at ৳120, name kept (got ${typed.status}, ৳${typed.charge})`,
      typed.msg
    );

    const spelledLikeListed = await quote(null, KHULNA, { medicalCollegeName: 'Gazi Medical College' });
    check(
      spelledLikeListed.charge === 100,
      `a typed name spelt exactly like a listed college is that college → ৳100 (got ৳${spelledLikeListed.charge})`
    );
  }

  console.log('\n── COD surcharge and the free-above threshold ──');
  {
    await Settings.updateOne({}, { $set: { codExtraCharge: 20 } });
    const g = await quote(gazi, KHULNA);
    check(g.charge === 120, `Gazi rate ৳100 + COD ৳20 → ৳120 (got ৳${g.charge})`);
    const k = await quote(kmc, KHULNA);
    check(k.charge === 0, `a free college stays free under COD → ৳0 (got ৳${k.charge})`);
    const s = await quote(dmc, { division: 'ঢাকা', district: 'ঢাকা', upazila: 'শাহবাগ' });
    check(s.charge === 140, `standard ৳120 + COD ৳20 → ৳140 (got ৳${s.charge})`);
    const online = await quote(gazi, KHULNA, { paymentMethod: undefined });
    check(online.charge === 100, `paying online, no COD surcharge → ৳100 (got ৳${online.charge})`, online.msg);
    await Settings.updateOne({}, { $set: { codExtraCharge: 0 } });

    await Settings.updateOne({}, { $set: { freeDeliveryAbove: 400 } });
    const free = await quote(dmc, { division: 'ঢাকা', district: 'ঢাকা', upazila: 'শাহবাগ' });
    check(free.charge === 0 && free.rule === 'free-above', `a ৳500 order over a ৳400 threshold → ৳0 free-above (got ৳${free.charge}, ${free.rule})`);
    await Settings.updateOne({}, { $set: { freeDeliveryAbove: 0 } });
  }

  console.log('\n── The rule on its own ──');
  {
    const c = { district: 'খুলনা', upazila: 'খুলনা সদর', deliveryCharge: 100 };
    check(collegeRateApplies(c, ' খুলনা ', 'খুলনা  সদর'), 'extra spaces do not break a match');
    check(!collegeRateApplies({ ...c, deliveryCharge: null }, 'খুলনা', 'খুলনা সদর'), 'null rate → no');
    check(!collegeRateApplies(c, 'খুলনা', ''), 'empty upazila on the parcel → no');
    check(!collegeRateApplies(null, 'খুলনা', 'খুলনা সদর'), 'no college → no');
  }

  // ── Admin: setting a rate ────────────────────────────────────────────────
  const tokenFor = async (email: string, role: string) => {
    await api().post('/api/auth/register').send({
      firstName: 'A', lastName: 'B', email, password: 'pass1234', whatsappNumber: '01712345678',
    });
    await User.updateOne({ email }, { role, status: 'active' });
    return (
      await api().post('/api/auth/login').set('x-device-id', `dev-${email}`).send({ email, password: 'pass1234' })
    ).body?.data?.accessToken;
  };
  const admin = await tokenFor('admin@t.com', 'admin');
  const trainer = await tokenFor('trainer@t.com', 'trainingManager');

  console.log('\n── The delivery-charge screen ──');
  {
    const list = await api().get('/api/medical-colleges/delivery').set('Authorization', `Bearer ${admin}`);
    check(list.status === 200 && Array.isArray(list.body?.data), `admin can list colleges with rates (${list.status})`);

    const set = await api()
      .patch(`/api/medical-colleges/${dmc._id}/delivery`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ deliveryCharge: 70 });
    check(set.status === 200 && set.body?.data?.deliveryCharge === 70, `admin sets Dhaka Medical College to ৳70 (${set.status})`, set.body?.message);
    const after = await quote(dmc, { division: 'ঢাকা', district: 'ঢাকা', upazila: 'শাহবাগ' });
    check(after.charge === 70, `…and the next order pays it (got ৳${after.charge})`);

    const cleared = await api()
      .patch(`/api/medical-colleges/${dmc._id}/delivery`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ deliveryCharge: null });
    check(cleared.status === 200 && cleared.body?.data?.deliveryCharge === null, 'clearing the rate sets it back to null');
    const back = await quote(dmc, { division: 'ঢাকা', district: 'ঢাকা', upazila: 'শাহবাগ' });
    check(back.charge === 120, `…and the standard charge applies again (got ৳${back.charge})`);

    const bad = await api()
      .patch(`/api/medical-colleges/${dmc._id}/delivery`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ deliveryCharge: '50' });
    check(bad.status === 400, `a rate sent as text is refused (${bad.status})`);

    const upz = await api()
      .patch(`/api/medical-colleges/${noUpazila._id}/delivery`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ upazila: '  যশোর   সদর ' });
    check(upz.body?.data?.upazila === 'যশোর সদর', `an upazila is saved trimmed and single-spaced ("${upz.body?.data?.upazila}")`);
  }

  console.log('\n── Only settings.write can change a rate ──');
  {
    const denied = await api()
      .patch(`/api/medical-colleges/${gazi._id}/delivery`)
      .set('Authorization', `Bearer ${trainer}`)
      .send({ deliveryCharge: 1 });
    check(denied.status === 403, `a training manager (users.write, no settings.write) is refused (${denied.status})`);

    // The directory edit the trainer CAN reach must not carry a rate through.
    const sneak = await api()
      .patch(`/api/medical-colleges/${gazi._id}`)
      .set('Authorization', `Bearer ${trainer}`)
      .send({ deliveryCharge: 1 });
    const g: any = await MedicalCollege.findById(gazi._id).lean();
    check(sneak.status === 200 && g.deliveryCharge === 100, `…and the directory edit drops a rate it was sent (still ৳${g.deliveryCharge})`);
  }

  console.log('\n── Published to the storefront ──');
  {
    const pub = await api().get('/api/medical-colleges');
    const row = (pub.body?.data || []).find((c: any) => c.name === 'Gazi Medical College');
    check(row?.upazila === 'খুলনা সদর' && row?.deliveryCharge === 100, 'the public list carries upazila and rate', row);

    const opts = await api().get('/api/orders/checkout-options');
    check(opts.body?.data?.deliveryCharge === 120, `checkout-options quotes the standard ৳120 (got ${opts.body?.data?.deliveryCharge})`);
    check(!('freeDeliveryCollege' in (opts.body?.data || {})), 'the retired free-college fields are gone from checkout-options');
  }

  console.log('\n── The Khulna rules move onto the colleges, once ──');
  {
    await MedicalCollege.updateMany({}, { $set: { deliveryCharge: null } });
    const other = await mkCollege('Khulna City Medical College', 'খুলনা', 'খুলনা', 'খুলনা সদর', null);
    await Settings.updateOne({}, {
      $set: { freeDeliveryCollege: 'Khulna Medical College', localDeliveryDistrict: 'খুলনা', localDeliveryCharge: 100 },
      $unset: { collegeDeliveryMigratedAt: 1 },
    });

    const moved = await MedicalCollegeService.migrateLegacyDeliveryRates();
    const rate = async (id: any) => ((await MedicalCollege.findById(id).lean()) as any)?.deliveryCharge;
    check((await rate(kmc._id)) === 0, `Khulna Medical College → ৳0`);
    check((await rate(gazi._id)) === 100 && (await rate(other._id)) === 100, `the other Khulna colleges → ৳100`);
    check((await rate(rmc._id)) === null && (await rate(dmc._id)) === null, 'colleges outside Khulna untouched');
    check(moved.length === 3, `reports what it moved (${moved.length})`, moved);

    await MedicalCollege.updateOne({ _id: gazi._id }, { $set: { deliveryCharge: null } });
    const again = await MedicalCollegeService.migrateLegacyDeliveryRates();
    check(again.length === 0 && (await rate(gazi._id)) === null, 'a second run changes nothing — a cleared rate stays cleared');

    // A settings document saved before these fields existed stores none of them.
    // The old pricing applied the schema defaults to it all the same (Khulna
    // Medical College free, the rest of Khulna ৳100), so the move must too.
    await MedicalCollege.updateMany({}, { $set: { deliveryCharge: null } });
    await Settings.collection.updateOne({}, {
      $unset: {
        freeDeliveryCollege: '', freeDeliveryDivision: '', localDeliveryDistrict: '',
        localDeliveryCharge: '', collegeDeliveryMigratedAt: '',
      },
    });
    const fromDefaults = await MedicalCollegeService.migrateLegacyDeliveryRates();
    check(
      (await rate(kmc._id)) === 0 && (await rate(gazi._id)) === 100 && (await rate(other._id)) === 100,
      'a settings document that never stored the Khulna fields still moves them, from the defaults',
      fromDefaults
    );
  }

  console.log('\n── The seed fills upazilas, and names the Jamalpur placeholder ──');
  {
    await MedicalCollege.updateOne({ _id: dmc._id }, { $set: { upazila: '' } });
    await MedicalCollege.updateOne({ _id: rmc._id }, { $set: { upazila: 'বোয়ালিয়া' } });
    await MedicalCollege.create({
      name: '(নাম যাচাই করুন) জামালপুর — 2014', searchKey: 'jamalpur', type: 'government',
      division: 'ময়মনসিংহ', district: 'জামালপুর', established: 2014, needsReview: true, isActive: false,
    });

    await MedicalCollegeService.seedFromFile();
    const filled = await MedicalCollegeService.backfillUpazilas();

    const d: any = await MedicalCollege.findById(dmc._id).lean();
    const r: any = await MedicalCollege.findById(rmc._id).lean();
    check(d.upazila === 'শাহবাগ', `a blank upazila is filled from the seed ("${d.upazila}")`);
    check(r.upazila === 'বোয়ালিয়া', `one an admin set is left alone ("${r.upazila}")`);
    check(filled > 0, `backfill reports its count (${filled})`);

    const jamalpur = await MedicalCollege.find({ district: 'জামালপুর', established: 2014 }).lean();
    check(
      jamalpur.length === 1 && jamalpur[0].name === 'Jamalpur Medical College (Sheikh Hasina MC)' &&
        jamalpur[0].isActive === true && jamalpur[0].needsReview === false,
      'the placeholder row is renamed in place — one row, active, not flagged',
      jamalpur.map((j: any) => j.name)
    );
    check(await MedicalCollege.countDocuments({}) >= 112, 'the rest of the 112 were seeded');
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
