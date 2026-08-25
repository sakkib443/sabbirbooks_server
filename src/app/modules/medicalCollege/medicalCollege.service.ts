/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidObjectId } from 'mongoose';
import { MedicalCollege, toSearchKey } from './medicalCollege.model';
import { IMedicalCollege, TCollegeType } from './medicalCollege.interface';
import { MEDICAL_COLLEGES } from '../../data/medicalColleges';

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
        name: `(নাম যাচাই করুন) ${orphan.district} — ${orphan.established}`,
        searchKey: toSearchKey(orphan.district),
        needsReview: true,
        isActive: false,
      });
    }
  }

  return { inserted: missing.length, existing: existingNames.size };
};

/**
 * The public list for the signup dropdown.
 *
 * Returns everything by default: 112 rows is a small payload, and shipping it
 * once lets the client filter as the user types with no request per keystroke.
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
    .select('name type division district area')
    .sort({ type: 1, name: 1 })
    .lean();
};

/** Admin view — includes retired rows and the ones flagged for review. */
const listAll = async () =>
  MedicalCollege.find({}).sort({ needsReview: -1, type: 1, name: 1 }).lean();

const getById = async (id: string) => {
  if (!isValidObjectId(id)) return null;
  return MedicalCollege.findById(id).lean();
};

const create = async (payload: Partial<IMedicalCollege>) => {
  const doc = new MedicalCollege({
    ...payload,
    searchKey: toSearchKey(payload.name || ''),
  });
  return doc.save();
};

const update = async (id: string, payload: Partial<IMedicalCollege>) => {
  if (!isValidObjectId(id)) throw new Error('Invalid college id');
  const patch: Record<string, unknown> = { ...payload };
  // searchKey is derived, never accepted from the client.
  delete patch.searchKey;
  if (payload.name) patch.searchKey = toSearchKey(payload.name);
  // Editing a flagged row is what clears the flag.
  if (payload.name && !('needsReview' in payload)) patch.needsReview = false;
  return MedicalCollege.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
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
  listPublic,
  listAll,
  getById,
  create,
  update,
  deactivate,
  getRegions,
};

export type { TCollegeType };
