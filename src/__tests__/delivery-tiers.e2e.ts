/* eslint-disable no-console */
/**
 * What a parcel costs to send — three tiers (isolated in-memory MongoDB, real
 * Express app via supertest; never the live DB).
 *
 * The shop is run out of Khulna Medical College, so:
 *
 *   free    a KMC student shipping within Khulna division — handed over on campus
 *   local   any OTHER college in Khulna district — a short courier hop
 *   flat    everywhere else in the country
 *
 * The tier is decided by the buyer's COLLEGE, not by the address they typed.
 * A Khulna student sending a book to their family home in Barishal is a
 * national parcel; a student who mistypes their hostel address should not lose
 * the local rate over it. That distinction is the thing worth testing.
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

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Book } = await import('../app/modules/book/book.model');
  const { User } = await import('../app/modules/user/user.model');
  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const { Settings } = await import('../app/modules/settings/settings.model');

  const api = () => request(app);

  // The shop's own settings, as they are on live.
  await Settings.create({
    deliveryCharge: 120,
    freeDeliveryCollege: 'Khulna Medical College',
    freeDeliveryDivision: 'খুলনা',
    localDeliveryDistrict: 'খুলনা',
    localDeliveryCharge: 100,
    codExtraCharge: 0,
  } as any);

  const mkCollege = (name: string, district: string, division: string, type = 'private') =>
    MedicalCollege.create({
      name, searchKey: name.toLowerCase(), type, division, district,
    });

  const kmc = await mkCollege('Khulna Medical College', 'খুলনা', 'খুলনা', 'government');
  const gazi = await mkCollege('Gazi Medical College', 'খুলনা', 'খুলনা');
  const adDin = await mkCollege('Ad-din Akij Medical College', 'খুলনা', 'খুলনা');
  const dhaka = await mkCollege('Dhaka Medical College', 'ঢাকা', 'ঢাকা', 'government');
  const raj = await mkCollege('Rajshahi Medical College', 'রাজশাহী', 'রাজশাহী', 'government');

  await Book.create({
    id: 1, title: 'Anatomy MAGIC VIVA', slug: 'anatomy-magic-viva',
    price: 500, author: 'Sabbir', category: 'medical', description: 'test',
    format: 'printed', stock: 500,
  });

  let n = 0;
  /** Place one COD order as a student of `college`, shipping to `division`. */
  const quote = async (college: any, division: string, district = division) => {
    n += 1;
    const email = `buyer${n}@t.com`;
    await api().post('/api/auth/register').send({
      firstName: 'B', lastName: 'T', email, password: 'pass1234', whatsappNumber: '01712345678',
    });
    await User.updateOne(
      { email },
      { medicalCollege: college._id, medicalCollegeName: college.name }
    );
    const token = (
      await api().post('/api/auth/login').set('x-device-id', `d${n}`)
        .send({ email, password: 'pass1234' })
    ).body?.data?.accessToken;

    const r = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        shippingAddress: {
          name: 'B', phone: '01700000000', address: 'Rd 5',
          city: district, district, division,
        },
        paymentMethod: 'cod',
        medicalCollegeName: college.name,
      });
    return { charge: r.body?.data?.deliveryCharge, status: r.status, msg: r.body?.message };
  };

  console.log('\n── The shop\'s own college pays nothing ──');
  {
    const r = await quote(kmc, 'খুলনা');
    check(r.charge === 0, `KMC student, shipping within Khulna → ৳0 (got ৳${r.charge})`, r.msg);
  }

  console.log('\n── Khulna\'s other medical colleges pay the local rate ──');
  {
    const g = await quote(gazi, 'খুলনা');
    check(g.charge === 100, `Gazi Medical College → ৳100 (got ৳${g.charge})`, g.msg);

    const a = await quote(adDin, 'খুলনা');
    check(a.charge === 100, `Ad-din Akij Medical College → ৳100 (got ৳${a.charge})`, a.msg);
  }

  console.log('\n── Everywhere else pays the flat rate ──');
  {
    const d = await quote(dhaka, 'ঢাকা');
    check(d.charge === 120, `Dhaka Medical College → ৳120 (got ৳${d.charge})`, d.msg);

    const r = await quote(raj, 'রাজশাহী');
    check(r.charge === 120, `Rajshahi Medical College → ৳120 (got ৳${r.charge})`, r.msg);
  }

  console.log('\n── The college decides the tier, not the typed address ──');
  {
    // A Khulna student sending the book to their family home in Barishal. The
    // parcel crosses the country, so it is not a local hop — but the OLD free
    // rule keyed on division, and this is the case that shows the difference.
    const away = await quote(gazi, 'বরিশাল');
    check(
      away.charge === 100,
      `a Gazi student shipping to Barishal still gets the local rate (৳${away.charge})`
    );
    console.log(
      '     ↑ worth the shop knowing: the rate follows the COLLEGE, so a Khulna\n' +
      '       student ordering to a home address anywhere still pays ৳100. Keying\n' +
      '       it on the address instead would let anyone type "Khulna" to get it.'
    );

    // And the reverse: a Dhaka student who types a Khulna address does NOT get
    // the local rate, which is the direction that would have cost the shop money.
    const pretend = await quote(dhaka, 'খুলনা');
    check(
      pretend.charge === 120,
      `a Dhaka student typing a Khulna address still pays ৳120 (got ৳${pretend.charge})`
    );
  }

  console.log('\n── The rate is a setting, not a constant ──');
  {
    await Settings.updateOne({}, { $set: { localDeliveryCharge: 80 } });
    const g = await quote(gazi, 'খুলনা');
    check(g.charge === 80, `changed to ৳80 in Settings and it took effect (got ৳${g.charge})`);

    // Switched off entirely: the local tier disappears and Khulna pays flat.
    await Settings.updateOne({}, { $set: { localDeliveryDistrict: '' } });
    const off = await quote(gazi, 'খুলনা');
    check(off.charge === 120, `cleared the district and Khulna falls back to flat (got ৳${off.charge})`);
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
