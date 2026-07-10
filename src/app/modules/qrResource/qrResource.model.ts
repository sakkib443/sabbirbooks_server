import { Schema, model } from 'mongoose';
import { IQrResource, IQrBlock } from './qrResource.interface';

// Content block subdocument — no own _id (mirrors enrollment's paymentSchema style).
const blockSchema = new Schema<IQrBlock>(
  {
    type: { type: String, enum: ['text', 'image', 'video'], required: true },
    // value = text body, image URL, or video URL/embed (depends on `type`)
    value: { type: String, required: true },
    caption: { type: String, required: false },
  },
  { _id: false }
);

// Mongoose Schema: how a QrResource is stored in the database.
const qrResourceSchema = new Schema<IQrResource>(
  {
    // Public URL key — the QR image encodes <clientOrigin>/r/:slug.
    // `unique` already builds the index, so the field is indexed by definition.
    slug: { type: String, required: true, unique: true, trim: true },

    // Which book — either a Book ref, a free-text title, or both.
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: false },
    bookTitle: { type: String, required: false, trim: true },

    // The question the QR code sits next to in the printed book.
    questionNo: { type: String, required: true, trim: true },
    questionText: { type: String, required: false },

    title: { type: String, required: true, trim: true },

    // Mixed text/image/video content shown on the resource page.
    blocks: { type: [blockSchema], default: [] },

    status: { type: String, enum: ['draft', 'published'], default: 'published' },

    // Incremented every time the public /api/qr/:slug endpoint serves this resource.
    views: { type: Number, default: 0 },
  },
  {
    timestamps: true, // createdAt এবং updatedAt ফিল্ড অটোমেটিক যোগ করবে
  }
);

// Speeds up admin search/filter by book + question number.
qrResourceSchema.index({ book: 1, questionNo: 1 });

export const QrResource = model<IQrResource>('QrResource', qrResourceSchema);
