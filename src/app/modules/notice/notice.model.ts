import { Schema, model } from 'mongoose';

// ─────────────────────────────────────────────────────────────
// Notice Board — admin/manager publishes notices (with optional
// PDF/image attachment). audience decides who can see it:
//   'public'   → everyone (public footer page + student board)
//   'enrolled' → only students with an active enrollment (student board)
// ─────────────────────────────────────────────────────────────
const noticeSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
    attachmentUrl: { type: String },
    attachmentType: { type: String, enum: ['image', 'pdf', 'file'] },
    attachmentName: { type: String },
    audience: { type: String, enum: ['public', 'enrolled'], default: 'public', required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

noticeSchema.index({ audience: 1, isActive: 1, createdAt: -1 });

export const Notice = model('Notice', noticeSchema);
