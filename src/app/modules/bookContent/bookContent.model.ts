import { Schema, model } from 'mongoose';
import crypto from 'crypto';
import {
  IBookPart,
  IBookChapter,
  IBookTopic,
  IBookQuestion,
  IQuestionVideo,
  IQuestionAttachment,
} from './bookContent.interface';

// Ambiguous glyphs (0/O, 1/I/l) are excluded: these codes get printed small and
// read off paper, and a misread character means a dead QR.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Random, non-sequential topic code. 32^8 ≈ 1.1e12 — not enumerable. */
export const generateQrCode = (): string => {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
};

// ─── Part ───────────────────────────────────────────────────
const bookPartSchema = new Schema<IBookPart>(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    title: { type: String, required: true, trim: true },
    titleBn: { type: String, trim: true },
    order: { type: Number, required: true, default: 1 },
    isPublished: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

bookPartSchema.index({ bookId: 1, order: 1 });

// ─── Chapter ────────────────────────────────────────────────
const bookChapterSchema = new Schema<IBookChapter>(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    partId: { type: Schema.Types.ObjectId, ref: 'BookPart', required: true },
    chapterNo: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    titleBn: { type: String, trim: true },
    order: { type: Number, required: true, default: 1 },
    isPublished: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Scoped to the PART, not the book: "General Histology" is chapter 5 of Board I
// and chapter 3 of Board II, and both numbering runs restart at 1.
bookChapterSchema.index({ partId: 1, order: 1 });
bookChapterSchema.index({ bookId: 1 });

// ─── Topic ──────────────────────────────────────────────────
const bookTopicSchema = new Schema<IBookTopic>(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    partId: { type: Schema.Types.ObjectId, ref: 'BookPart', required: true },
    chapterId: { type: Schema.Types.ObjectId, ref: 'BookChapter', required: true },
    topicNo: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    titleBn: { type: String, trim: true },

    qrCode: { type: String, required: true, unique: true, trim: true },
    isImplicit: { type: Boolean, default: false },

    scanCount: { type: Number, default: 0 },
    order: { type: Number, required: true, default: 1 },
    isPublished: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// `unique: true` on qrCode already builds its index.
bookTopicSchema.index({ chapterId: 1, order: 1 });
bookTopicSchema.index({ bookId: 1 });

// ─── Question ───────────────────────────────────────────────
const videoSchema = new Schema<IQuestionVideo>(
  {
    title: { type: String, trim: true },
    url: { type: String, required: true, trim: true },
    provider: {
      type: String,
      enum: ['youtube', 'vimeo', 'cloudinary', 'upload', 'other'],
      default: 'youtube',
    },
    durationSec: { type: Number },
    fileName: { type: String },
    fileSize: { type: Number },
  },
  { _id: true }
);

// Same shape as lesson.model's materialSchema so the two stay consistent.
const attachmentSchema = new Schema<IQuestionAttachment>(
  {
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number },
  },
  { _id: true }
);

const bookQuestionSchema = new Schema<IBookQuestion>(
  {
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    chapterId: { type: Schema.Types.ObjectId, ref: 'BookChapter', required: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'BookTopic', required: true },

    questionNo: { type: String, required: true, trim: true },
    questionText: { type: String },
    questionTextBn: { type: String },
    answerHtml: { type: String },

    videos: { type: [videoSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    images: { type: [String], default: [] },

    order: { type: Number, required: true, default: 1 },
    isPublished: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

bookQuestionSchema.index({ topicId: 1, order: 1 });
bookQuestionSchema.index({ bookId: 1 });

export const BookPart = model<IBookPart>('BookPart', bookPartSchema);
export const BookChapter = model<IBookChapter>('BookChapter', bookChapterSchema);
export const BookTopic = model<IBookTopic>('BookTopic', bookTopicSchema);
export const BookQuestion = model<IBookQuestion>('BookQuestion', bookQuestionSchema);
