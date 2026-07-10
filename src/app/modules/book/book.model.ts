import { Schema, model } from 'mongoose';
import { IBook } from './book.interface';

// Mongoose Schema: ডাটাবেজে Book কিভাবে সংরক্ষণ হবে তা নির্ধারণ করে
const bookSchema = new Schema<IBook>(
  {
    id: { type: Number, required: true, unique: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    author: { type: String, required: true },
    description: { type: String, required: true },
    coverImage: { type: String, required: true },

    price: { type: Number, required: true },
    offerPrice: { type: Number, required: false },

    category: { type: String, required: true },

    language: { type: String, enum: ['bn', 'en', 'both'], default: 'both' },
    format: { type: String, enum: ['printed', 'digital'], required: true },

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
