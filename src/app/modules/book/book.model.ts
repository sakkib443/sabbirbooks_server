import { Schema, model } from 'mongoose';
import { IBook, IBookFeature, IBookOffer, IBookOffers } from './book.interface';

// Landing-page selling points. Declared as its own schema with `_id: false` —
// the same convention the order module's embedded docs use — because these are
// display copy the admin rewrites wholesale, and per-row ids would just be noise
// in every API response.
const bookFeatureSchema = new Schema<IBookFeature>(
  {
    text: { type: String, required: true },
    weight: { type: Number, default: 1 },
    highlight: { type: Boolean, default: false },
  },
  { _id: false }
);

// One named discount. `percent` is capped at 90 like the pre-order field — this
// is applied to real money at checkout, so a typo'd 100 must not zero the price.
const bookOfferSchema = new Schema<IBookOffer>(
  {
    enabled: { type: Boolean, default: false },
    label: { type: String, default: '' },
    percent: { type: Number, default: 0, min: 0, max: 90 },
  },
  { _id: false }
);

// The three offers, each embedded and optional so a book with none is priced at
// list. See book.pricing.ts for how they combine.
const bookOffersSchema = new Schema<IBookOffers>(
  {
    normal: { type: bookOfferSchema, default: undefined },
    preorder: { type: bookOfferSchema, default: undefined },
    online: { type: bookOfferSchema, default: undefined },
  },
  { _id: false }
);

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

    // Named per-book offers (normal / pre-order / online-payment). Absent on
    // legacy books, which keep pricing off the fields below. See book.pricing.ts.
    offers: { type: bookOffersSchema, default: undefined },

    // Pre-order: the book can be bought before it is printed. Defaults keep every
    // existing book an ordinary stocked title, so nothing changes until an admin
    // ticks the box.
    isPreOrder: { type: Boolean, default: false },
    // Capped at 90 so a typo'd 100 (or 900) cannot hand the book away for free —
    // this number is applied to real money at checkout.
    preOrderDiscountPercent: { type: Number, default: 25, min: 0, max: 90 },
    preOrderNote: { type: String, default: '' },
    // Clearing the date field in the admin form posts '', which Mongoose would
    // reject as an invalid Date — read it as "no date set" instead of 400ing an
    // otherwise valid edit. null rather than undefined, because an undefined in
    // an update is dropped from the $set and would silently keep the old date.
    expectedReleaseDate: { type: Date, set: (v: unknown) => (v === '' ? null : v) },

    // Landing page content. promoVideoUrl holds either a YouTube link or a path
    // to a file uploaded through the media route, so it is not validated as a URL.
    promoVideoUrl: { type: String, default: '' },
    features: { type: [bookFeatureSchema], default: [] },

    rating: { type: Number, default: 0 },
    totalSold: { type: Number, default: 0 },
  },
  {
    timestamps: true, // createdAt এবং updatedAt ফিল্ড অটোমেটিক যোগ করবে
  }
);

export const Book = model<IBook>('Book', bookSchema);
