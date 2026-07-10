// Book Interface: catalog book (printed or digital) এর ডাটার ধরন নির্ধারণ করে
export interface IBook {
  id: number;
  title: string;
  slug: string;
  author: string;
  description: string;
  coverImage: string;

  price: number;
  offerPrice?: number;

  // Book category is stored as a simple string (e.g. "Anatomy", "Pharmacology").
  // Courses ref a Category ObjectId, but book categories are their own domain,
  // so we keep them self-contained as strings (easy to swap to a ref later).
  category: string;

  language: 'bn' | 'en' | 'both';
  format: 'printed' | 'digital';

  // Printed-only: how many copies are in stock.
  stock?: number;
  // Digital-only: the secured, purchasable file. Never returned on public routes.
  secureFileUrl?: string;

  // Publicly viewable preview material (a few sample pages / cover shots).
  previewImages?: string[];
  previewPdfUrl?: string;

  status: 'draft' | 'published' | 'archived';
  isFeatured: boolean;

  rating?: number;
  totalSold?: number;

  createdAt?: Date;
  updatedAt?: Date;
}
