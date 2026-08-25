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

const medicalCollegeSchema = new Schema<IMedicalCollege>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    searchKey: { type: String, required: true, index: true },
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
  next();
});

export const MedicalCollege = model<IMedicalCollege>('MedicalCollege', medicalCollegeSchema);
