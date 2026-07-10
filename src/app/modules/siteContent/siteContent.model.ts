import { Schema, model } from 'mongoose';

// Page-wise editable website content (CMS). One document per page (e.g. "contact"),
// `content` holds a flexible per-section JSON so new pages/sections need no schema change.
const siteContentSchema = new Schema(
  {
    page: { type: String, required: true, unique: true, lowercase: true, trim: true },
    content: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const SiteContent = model('SiteContent', siteContentSchema);
