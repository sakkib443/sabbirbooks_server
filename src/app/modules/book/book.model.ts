import { Schema, model } from 'mongoose';
import { IBook } from './book.interface';

// Mongoose Schema: ডাটাবেজে Book কিভাবে সংরক্ষণ হবে তা নির্ধারণ করে
// Simplified for the medical-book store: only `title` is required in practice —
// the service fills in id/slug when omitted and every other field is optional so
// a book can be added quickly and completed later.
const bookSchema = new Schema<IBook>(
  {
    id: { type: Number, required: true, unique: true },
    title: { type: String, required: true },
    slug: { type: String, required: false, unique: true },
    author: { type: String, required: false },
    description: { type: String, required: false },
    coverImage: { type: String, required: false },

    price: { type: Number, required: false, default: 0 },
    offerPrice: { type: Number, required: false },

    category: { type: String, required: false },

    language: { type: String, enum: ['bn', 'en', 'both'], default: 'both' },
    format: { type: String, enum: ['printed', 'digital'], default: 'printed' },

    // Printed-only stock count (digital books ignore this)
    stock: { type: Number, required: false, default: 0 },
    // Digital-only secured file — select:false keeps it out of public responses,
    // so listing/detail never leak the purchasable file URL.
    secureFileUrl: { type: String, required: false, select: false },

    previewImages: { type: [String], default: [] },
    previewPdfUrl: { type: String, required: false },

    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
    isFeatured: { type: Boolean, default: false },

    rating: { type: Number, default: 0 },
    totalSold: { type: Number, default: 0 },
  },
  {
    timestamps: true, // createdAt এবং updatedAt ফিল্ড অটোমেটিক যোগ করবে
  }
);

export const Book = model<IBook>('Book', bookSchema);
