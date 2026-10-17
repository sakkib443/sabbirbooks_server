import { Schema, model } from 'mongoose';

/**
 * A saved "where the video would be" message (18 Oct 2026).
 *
 * The shop used to have one fixed sentence ("যান্ত্রিক ত্রুটির কারণে
 * ভিডিওটি…") shown on every question without a video. They asked for it gone,
 * and instead to write their own messages, keep the ones they reuse, and put
 * any of them on any question. These are the kept ones — shared by every
 * book, picked in the question editor and in the many-at-once panel.
 */
const videoNotePresetSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

videoNotePresetSchema.index({ text: 1 }, { unique: true });

export const VideoNotePreset = model('VideoNotePreset', videoNotePresetSchema);
