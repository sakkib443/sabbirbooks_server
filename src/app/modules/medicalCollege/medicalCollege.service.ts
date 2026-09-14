/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidObjectId } from 'mongoose';
import { MedicalCollege, toSearchKey, deriveAbbreviation } from './medicalCollege.model';
import { IMedicalCollege, TCollegeType } from './medicalCollege.interface';
import { MEDICAL_COLLEGES } from '../../data/medicalColleges';
import { Settings } from '../settings/settings.model';
import { SettingsService } from '../settings/settings.services';

/** A row the PDF gave no name for was stored under this placeholder. */
const PLACEHOLDER_PREFIX = '(নাম যাচাই করুন)';

/**
 * Put the shipped list into the database, once.
 *
 * Deliberately insert-only. After the first run the admin panel is the source
 * of truth — a redeploy must not undo a correction someone made to a name or a
 * district, which is exactly what an upsert would do. New rows added to the
 * seed file in a later release still land, because the check is per-name.
 */
const seedFromFile = async (): Promise<{ inserted: number; existing: number }> => {
  const existingNames = new Set(
    (await MedicalCollege.find({}).select('name').lean()).map((c) => c.name)
  );

  // A row that was seeded under the placeholder because its name did not
  // survive the first PDF, and that a later seed file now names. Renaming it in
  // place — rather than letting the insert below add the named row beside it —
  // keeps one row per college, and keeps any student already pointing at it.
  for (const row of MEDICAL_COLLEGES) {
    if (!row.name || existingNames.has(row.name)) continue;
    const placeholder = await MedicalCollege.findOne({
      needsReview: true,
      district: row.district,
      established: row.established,
      name: { $regex: new RegExp(`^${PLACEHOLDER_PREFIX.replace(/[()]/g, '\\$&')}`) },
    });
    if (!placeholder) continue;
    placeholder.name = row.name;
    placeholder.needsReview = false;
    placeholder.isActive = true;
    if (!placeholder.upazila && row.upazila) placeholder.upazila = row.upazila;
    await placeholder.save();
    existingNames.add(row.name);
  }

  const missing = MEDICAL_COLLEGES.filter((c) => c.name && !existingNames.has(c.name));

  if (missing.length) {
    await MedicalCollege.insertMany(
      missing.map((c) => ({
        ...c,
        searchKey: toSearchKey(c.name),
        isActive: true,
      })),
      { ordered: false }
    );
  }

  // The source PDF has one row whose name cell did not survive extraction. It
  // is seeded blank-named only if nothing like it is there yet, so the admin
  // sees a row to fix rather than a silently missing college.
  const orphan = MEDICAL_COLLEGES.find((c) => c.needsReview && !c.name);
  if (orphan) {
    const already = await MedicalCollege.findOne({
      district: orphan.district,
      established: orphan.established,
    }).lean();
    if (!already) {
      await MedicalCollege.create({
        ...orphan,
        name: `${PLACEHOLDER_PREFIX} ${orphan.district} — ${orphan.established}`,
        searchKey: toSearchKey(orphan.district),
        needsReview: true,
        isActive: false,
      });
    }
  }

  return { inserted: missing.length, existing: existingNames.size };
};

/**
 * Give every college its upazila, once.
 *
 * The 112 rows were seeded with the upazila column blank, because the first
 * PDF's Bengali could not be read back reliably. The seed file now carries them,
 * matched by hand to the checkout's own address list. Fills blanks only — an
 * upazila an admin set on the delivery-charge screen is never overwritten, so
 * this is safe to run on every deploy.
 */
const backfillUpazilas = async (): Promise<number> => {
  const ops = MEDICAL_COLLEGES.filter((c) => c.name && c.upazila).map((c) => ({
    updateOne: {
      filter: { name: c.name, $or: [{ upazila: { $exists: false } }, { upazila: '' }] },
      update: { $set: { upazila: c.upazila } },
    },
  }));
  if (!ops.length) return 0;
  const res = await MedicalCollege.bulkWrite(ops, { ordered: false });
  return res.modifiedCount || 0;
};

/**
 * Carry the two Khulna rules that used to live in Settings onto the colleges.
 *
 * Before per-college rates existed, delivery had two special cases baked into
 * the settings document: `freeDeliveryCollege` (Khulna Medical College, free)
 * and `localDeliveryDistrict` + `localDeliveryCharge` (every other college in
 * Khulna district, ৳100). Those rates now belong on the college rows, where the
 * admin can see and change them. Run once: a stamp on Settings stops a later
 * deploy from putting back a rate the admin has since cleared.
 *
 * One thing changes for those students, on purpose and at the shop's request:
 * the rate now also needs the parcel to go to the college's own district and
 * upazila, where the old ৳100 rule followed the college wherever it shipped.
 */
const migrateLegacyDeliveryRates = async (): Promise<string[]> => {
  // Read exactly the way the old pricing read it — a full document, not lean().
  // Those fields have schema defaults (Khulna Medical College, খুলনা, ৳100), and
  // a settings document saved before they existed does not store them, yet the
  // old rules applied through the defaults all the same. lean() would see blanks
  // there and silently drop the Khulna rates.
  const s: any = await SettingsService.getSettingsService();
  if (!s || s.collegeDeliveryMigratedAt) return [];

  const changed: string[] = [];
  const freeCollege = String(s.freeDeliveryCollege || '').trim();
  if (freeCollege) {
    const res = await MedicalCollege.updateOne(
      { name: freeCollege, deliveryCharge: null },
      { $set: { deliveryCharge: 0 } }
    );
    if (res.modifiedCount) changed.push(`${freeCollege} → ৳0`);
  }

  const localDistrict = String(s.localDeliveryDistrict || '').trim();
  const localRate = Number(s.localDeliveryCharge);
  if (localDistrict && Number.isFinite(localRate) && localRate >= 0) {
    const rows = await MedicalCollege.find({
      district: localDistrict,
      name: { $ne: freeCollege },
      isActive: true,
      deliveryCharge: null,
    })
      .select('_id name')
      .lean();
    if (rows.length) {
      await MedicalCollege.updateMany(
        { _id: { $in: rows.map((r) => r._id) } },
        { $set: { deliveryCharge: Math.round(localRate) } }
      );
      changed.push(...rows.map((r) => `${r.name} → ৳${Math.round(localRate)}`));
    }
  }

  await Settings.updateOne({ _id: s._id }, { $set: { collegeDeliveryMigratedAt: new Date() } });
  return changed;
};

/**
 * The public list for the signup dropdown and the checkout.
 *
 * Returns everything by default: 112 rows is a small payload, and shipping it
 * once lets the client filter as the user types with no request per keystroke.
 * The upazila and the delivery rate ride along because the checkout fills the
 * address from the college and prices delivery from it — both are published
 * facts the buyer sees at checkout anyway.
 */
const listPublic = async (query: { q?: string; type?: string; district?: string }) => {
  const filter: Record<string, unknown> = { isActive: true };

  if (query.type && ['government', 'private', 'army'].includes(query.type)) {
    filter.type = query.type;
  }
  if (query.district) filter.district = query.district;

  const q = toSearchKey(query.q || '');
  if (q) filter.searchKey = { $regex: q.split(' ').join('.*'), $options: 'i' };

  return MedicalCollege.find(filter)
    // abbreviation ships with the list because the ambassador form previews the
    // coupon code as the applicant types — one payload, no request per keystroke.
    .select('name type division district area upazila deliveryCharge abbreviation')
    .sort({ type: 1, name: 1 })
    .lean();
};

/**
 * Give every college an abbreviation, once.
 *
 * The 112 rows were seeded before Campus Ambassador coupon codes existed, so
 * they have none, and a code cannot be built without one. Runs at boot beside
 * the seed. Only fills blanks — an abbreviation the shop supplied or an admin
 * typed is never touched, so this is safe to run on every deploy for ever.
 */
const backfillAbbreviations = async (): Promise<number> => {
  const missing = await MedicalCollege.find({
    $or: [{ abbreviation: { $exists: false } }, { abbreviation: '' }],
  })
    .select('_id name')
    .lean();

  let filled = 0;
  for (const row of missing) {
    const abbr = deriveAbbreviation(row.name);
    if (!abbr) continue;
    await MedicalCollege.updateOne(
      { _id: row._id },
      { $set: { abbreviation: abbr, abbreviationSource: 'derived' } }
    );
    filled++;
  }
  return filled;
};

/** Admin view — includes retired rows and the ones flagged for review. */
const listAll = async () =>
  MedicalCollege.find({}).sort({ needsReview: -1, type: 1, name: 1 }).lean();

/** The delivery-charge screen: every college with where it is and what it pays. */
const listForDelivery = async () =>
  MedicalCollege.find({})
    .select('name type division district upazila area deliveryCharge isActive needsReview')
    .sort({ isActive: -1, type: 1, name: 1 })
    .lean();

const getById = async (id: string) => {
  if (!isValidObjectId(id)) return null;
  return MedicalCollege.findById(id).lean();
};

const create = async (payload: Partial<IMedicalCollege>) => {
  const patch: Record<string, unknown> = { ...payload };
  // A rate is set on the delivery-charge screen, behind settings.write.
  delete patch.deliveryCharge;
  const doc = new MedicalCollege({
    ...patch,
    searchKey: toSearchKey(payload.name || ''),
  });
  return doc.save();
};

const update = async (id: string, payload: Partial<IMedicalCollege>) => {
  if (!isValidObjectId(id)) throw new Error('Invalid college id');
  const patch: Record<string, unknown> = { ...payload };
  // searchKey is derived, never accepted from the client.
  delete patch.searchKey;
  // Money is not a directory edit. This route is open to managers; the rate
  // lives behind settings.write on its own route (setDelivery below).
  delete patch.deliveryCharge;
  if (payload.name) patch.searchKey = toSearchKey(payload.name);
  // Editing a flagged row is what clears the flag.
  if (payload.name && !('needsReview' in payload)) patch.needsReview = false;
  // An abbreviation an admin typed is authoritative, and must stop being
  // re-derived from the name afterwards. Set here rather than in the schema
  // hook because findByIdAndUpdate does not run pre('save').
  if (typeof payload.abbreviation === 'string' && payload.abbreviation.trim()) {
    patch.abbreviationSource = 'official';
  }
  return MedicalCollege.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
};

/**
 * Set a college's delivery rate and/or its upazila, from the delivery-charge
 * screen. The two travel together because the rate is useless without an
 * upazila to match the parcel's address against.
 */
const setDelivery = async (
  id: string,
  payload: { deliveryCharge?: number | null; upazila?: string }
) => {
  if (!isValidObjectId(id)) throw new Error('Invalid college id');
  const patch: Record<string, unknown> = {};
  if (payload.deliveryCharge !== undefined) {
    patch.deliveryCharge =
      payload.deliveryCharge === null ? null : Math.max(0, Math.round(Number(payload.deliveryCharge)));
  }
  if (payload.upazila !== undefined) {
    patch.upazila = String(payload.upazila).trim().replace(/\s+/g, ' ');
  }
  if (!Object.keys(patch).length) throw new Error('Nothing to update');
  return MedicalCollege.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
    .select('name type division district upazila area deliveryCharge isActive needsReview')
    .lean();
};

/**
 * Retire rather than delete: students already reference this college, and a
 * hard delete would leave their profile pointing at nothing.
 */
const deactivate = async (id: string) => {
  if (!isValidObjectId(id)) throw new Error('Invalid college id');
  return MedicalCollege.findByIdAndUpdate(id, { isActive: false }, { new: true });
};

/** Every distinct division and district actually present, for filter menus. */
const getRegions = async () => {
  const [divisions, districts] = await Promise.all([
    MedicalCollege.distinct('division', { isActive: true }),
    MedicalCollege.distinct('district', { isActive: true }),
  ]);
  return { divisions: divisions.sort(), districts: districts.sort() };
};

export const MedicalCollegeService = {
  seedFromFile,
  backfillUpazilas,
  migrateLegacyDeliveryRates,
  backfillAbbreviations,
  listPublic,
  listAll,
  listForDelivery,
  getById,
  create,
  update,
  setDelivery,
  deactivate,
  getRegions,
};

export type { TCollegeType };
