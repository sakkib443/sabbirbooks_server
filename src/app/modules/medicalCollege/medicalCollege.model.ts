import { Schema, model } from 'mongoose';
import { IMedicalCollege } from './medicalCollege.interface';

/**
 * Strip a college name down to something a typo-prone search can match:
 * lower-case, no punctuation, single spaces. Stored alongside the display name
 * so the signup dropdown can query an indexed field instead of running a regex
 * over 112 documents on every keystroke.
 */
export const toSearchKey = (name: string): string =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9ঀ-৿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words that carry no identity, so they never contribute an initial. */
const ABBR_STOPWORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in', '&']);

/**
 * A best guess at how students would write this college: the initials of its
 * significant words. "Dhaka Medical College" → DMC.
 *
 * A guess, and only ever a fallback for a row the shop has not given a real
 * abbreviation for. The real ones do not always follow the rule — Sylhet MAG
 * Osmani Medical College is SOMC, not SMOMC — which is why anything produced
 * here is stored with `abbreviationSource: 'derived'` and shown to the admin as
 * editable rather than treated as fact.
 *
 * Returns '' for a name with nothing latin in it; the caller decides what to do
 * rather than getting an empty-looking abbreviation it did not expect.
 */
export const deriveAbbreviation = (name: string): string => {
  const raw = String(name || '');

  // Some names carry their own abbreviation in brackets — "Armed Forces Medical
  // College (AFMC)". That is not a guess to improve on, it is the answer, and
  // taking the initials as well produced AFMCAFMC.
  const bracketed = /\(([A-Z][A-Z0-9]{1,9})\)/.exec(raw);
  if (bracketed) return bracketed[1];

  // The town in "Army Medical College, Bogura" is kept, deliberately: it is the
  // only thing separating five Army Medical Colleges, and a fallback that
  // silently gives all five the same abbreviation would hand five different
  // campuses the same coupon prefix. AMCB / AMCC / AMCJ is not what students
  // write, but it identifies the college, which is what the code is for — and
  // the shop's own list replaces all of this anyway.
  return raw
    .replace(/[^A-Za-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !ABBR_STOPWORDS.has(w.toLowerCase()))
    // An all-caps word inside the name is already an abbreviation (MAG in
    // "Sylhet MAG Osmani"), so it contributes itself, not just its first letter.
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w[0].toUpperCase()))
    .join('')
    .slice(0, 10);
};

const medicalCollegeSchema = new Schema<IMedicalCollege>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    searchKey: { type: String, required: true, index: true },
    // Deliberately NOT unique: two colleges can genuinely share initials
    // (Sir Salimullah and Shaheed Suhrawardy are both SSMC by the naive rule).
    // Uniqueness belongs to the coupon code, which is built from this plus the
    // ambassador's own name and is unique there.
    abbreviation: { type: String, trim: true, uppercase: true, default: '' },
    abbreviationSource: {
      type: String,
      enum: ['official', 'derived'],
      default: 'derived',
    },
    type: {
      type: String,
      enum: ['government', 'private', 'army'],
      required: true,
    },
    division: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    area: { type: String, trim: true, default: '' },
    established: { type: Number },
    seats: { type: Number, default: null },
    needsReview: { type: Boolean, default: false },
    // Soft retirement: a student who signed up naming a college that later
    // closes must still resolve to it, so rows are deactivated, never removed.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// The signup list is always "active colleges, grouped by type, alphabetical".
medicalCollegeSchema.index({ isActive: 1, type: 1, name: 1 });
// The checkout address prefill looks a college up by district.
medicalCollegeSchema.index({ district: 1 });

medicalCollegeSchema.pre('save', function (next) {
  if (this.isModified('name')) this.searchKey = toSearchKey(this.name);
  // A name change re-derives a guessed abbreviation, but never overwrites one
  // the shop supplied — that is the whole point of tracking the source.
  if (!this.abbreviation || (this.isModified('name') && this.abbreviationSource !== 'official')) {
    this.abbreviation = deriveAbbreviation(this.name);
    this.abbreviationSource = 'derived';
  }
  // An abbreviation typed by an admin is official by definition.
  if (this.isModified('abbreviation') && !this.isModified('name')) {
    this.abbreviationSource = 'official';
  }
  next();
});

export const MedicalCollege = model<IMedicalCollege>('MedicalCollege', medicalCollegeSchema);
