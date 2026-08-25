// One selling point on the book's landing page. `weight` orders them (bigger =
// louder) and `highlight` paints one in the accent red, so the shop owner can
// re-arrange the pitch from the admin form without a deploy.
export interface IBookFeature {
  text: string;
  weight?: number;
  highlight?: boolean;
}

// Book Interface: catalog book (printed or digital) এর ডাটার ধরন নির্ধারণ করে
export interface IBook {
  id: number;
  title: string;
  slug?: string;
  author?: string;
  description?: string;
  coverImage?: string;

  price?: number;
  offerPrice?: number;

  // Book category is stored as a simple string (e.g. "Anatomy", "Pharmacology").
  // Courses ref a Category ObjectId, but book categories are their own domain,
  // so we keep them self-contained as strings (easy to swap to a ref later).
  category?: string;

  language?: 'bn' | 'en' | 'both';
  format?: 'printed' | 'digital';

  // Printed-only: how many copies are in stock.
  stock?: number;
  // Digital-only: the secured, purchasable file. Never returned on public routes.
  secureFileUrl?: string;

  // Publicly viewable preview material (a few sample pages / cover shots).
  previewImages?: string[];
  previewPdfUrl?: string;

  status?: 'draft' | 'published' | 'archived';
  isFeatured?: boolean;

  // ── Pre-order ──
  // The book is sold before the print run exists. Every field below is optional
  // so the thousands of already-published books keep loading untouched.
  isPreOrder?: boolean;
  // Percent knocked off this book's lines at checkout while it is a pre-order.
  // Per-book rather than a site-wide constant: an early title may be discounted
  // harder than a reprint.
  preOrderDiscountPercent?: number;
  // Free-text promise shown next to the buy button ("১৫ সেপ্টেম্বর থেকে ডেলিভারি").
  preOrderNote?: string;
  expectedReleaseDate?: Date;

  // ── Landing page content ──
  promoVideoUrl?: string;
  features?: IBookFeature[];

  rating?: number;
  totalSold?: number;

  createdAt?: Date;
  updatedAt?: Date;
}
