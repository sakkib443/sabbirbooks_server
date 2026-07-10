import { Schema, model } from 'mongoose';

// ─────────────────────────────────────────────────────────────
// Partner / Collaboration — external websites shown as a scrolling
// logo carousel on the homepage. Each logo links out to its site.
// Admin-managed; public.
// ─────────────────────────────────────────────────────────────
const partnerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    logoUrl: { type: String, required: true },
    websiteUrl: { type: String, trim: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

partnerSchema.index({ isActive: 1, order: 1 });

export const Partner = model('Partner', partnerSchema);
