/**
 * Medical college directory — seeding and lookup.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the live database, and a seed test that reached it
 * would write 112 rows into production.
 *
 * Run: npx ts-node src/__tests__/medical-college.e2e.ts
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'college-test' });

  const { MedicalCollege, toSearchKey } = await import(
    '../app/modules/medicalCollege/medicalCollege.model'
  );
  const { MedicalCollegeService } = await import(
    '../app/modules/medicalCollege/medicalCollege.service'
  );
  const { MEDICAL_COLLEGES } = await import('../app/data/medicalColleges');

  console.log('\n── seed ────────────────────────────────────────');

  const first = await MedicalCollegeService.seedFromFile();
  const total = await MedicalCollege.countDocuments();
  check('seeds every named row', first.inserted === MEDICAL_COLLEGES.filter(c => c.name).length, {
    inserted: first.inserted,
  });
  check('112 institutions in the directory', total === 112, { total });

  const byType = async (t: string) => MedicalCollege.countDocuments({ type: t });
  check('37 government', (await byType('government')) === 37, { n: await byType('government') });
  check('68 private', (await byType('private')) === 68, { n: await byType('private') });
  check('7 army', (await byType('army')) === 7, { n: await byType('army') });

  console.log('\n── seeding twice must not duplicate ────────────');

  // An admin corrects a name; a redeploy must not undo it.
  const dhaka = await MedicalCollege.findOne({ name: 'Dhaka Medical College' });
  await MedicalCollege.findByIdAndUpdate(dhaka!._id, { district: 'EDITED-BY-ADMIN' });

  const second = await MedicalCollegeService.seedFromFile();
  check('second run inserts nothing', second.inserted === 0, second);
  check('still 112 rows', (await MedicalCollege.countDocuments()) === 112);

  const after = await MedicalCollege.findById(dhaka!._id).lean();
  check("admin's edit survives a reseed", after?.district === 'EDITED-BY-ADMIN', {
    district: after?.district,
  });

  console.log('\n── the row whose name did not extract ──────────');

  const flagged = await MedicalCollege.find({ needsReview: true }).lean();
  check('exactly one row is flagged for review', flagged.length === 1, {
    n: flagged.length,
  });
  check('flagged row is hidden from the public list', flagged[0]?.isActive === false);
  check('flagged row kept its district', flagged[0]?.district === 'জামালপুর', {
    district: flagged[0]?.district,
  });

  console.log('\n── public list ────────────────────────────────');

  const pub = await MedicalCollegeService.listPublic({});
  check('public list excludes the flagged row', pub.length === 111, { n: pub.length });
  check(
    'public list never leaks internal fields',
    pub.every((c: any) => c.searchKey === undefined && c.needsReview === undefined)
  );

  console.log('\n── search ─────────────────────────────────────');

  const dhakaHits = await MedicalCollegeService.listPublic({ q: 'dhaka medical' });
  check('finds Dhaka Medical College', dhakaHits.some((c: any) => c.name === 'Dhaka Medical College'), {
    hits: dhakaHits.length,
  });

  const gapped = await MedicalCollegeService.listPublic({ q: 'salimullah' });
  check('matches on a middle word', gapped.some((c: any) => c.name.includes('Salimullah')));

  const cased = await MedicalCollegeService.listPublic({ q: 'ARMY MEDICAL' });
  check('search is case-insensitive', cased.length >= 5, { n: cased.length });

  // 36, not 37: the directory holds 37 government colleges but one of them is
  // the row whose name did not extract, which is seeded inactive and so is
  // correctly absent from a list meant for the signup dropdown.
  const govOnly = await MedicalCollegeService.listPublic({ type: 'government' });
  check('filters by type, excluding the inactive row', govOnly.length === 36, {
    n: govOnly.length,
  });
  check(
    'all 37 government rows still exist in the directory',
    (await MedicalCollege.countDocuments({ type: 'government' })) === 37
  );

  const byDistrict = await MedicalCollegeService.listPublic({ district: 'চট্টগ্রাম' });
  check('filters by district', byDistrict.length > 0, { n: byDistrict.length });

  console.log('\n── admin edit clears the review flag ──────────');

  const fixed = await MedicalCollegeService.update(String(flagged[0]._id), {
    name: 'Sheikh Hasina Medical College, Jamalpur',
    isActive: true,
  });
  check('name saved', fixed?.name === 'Sheikh Hasina Medical College, Jamalpur');
  check('review flag cleared by the edit', fixed?.needsReview === false);
  check('searchKey rebuilt from the new name', fixed?.searchKey === toSearchKey(fixed!.name));

  console.log('\n── retire, never delete ───────────────────────');

  const target = await MedicalCollege.findOne({ type: 'private' });
  await MedicalCollegeService.deactivate(String(target!._id));
  const stillThere = await MedicalCollege.findById(target!._id).lean();
  check('row survives deactivation', Boolean(stillThere), { found: Boolean(stillThere) });
  check('but drops out of the public list', stillThere?.isActive === false);

  console.log('\n── regions ────────────────────────────────────');

  const { divisions, districts } = await MedicalCollegeService.getRegions();
  check('all 8 divisions present', divisions.length === 8, { divisions });
  check('districts look sane', districts.length > 20 && districts.length <= 64, {
    n: districts.length,
  });

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
