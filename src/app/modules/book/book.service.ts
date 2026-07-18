/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidObjectId } from 'mongoose';
import { Book } from './book.model';
import { IBook } from './book.interface';

// URL-friendly slug from a title (falls back to a book-<id> stub).
const slugify = (s: string): string =>
  (s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

// CREATE → নতুন বই তৈরি করার সার্ভিস (id + slug অটো — শুধু title দিলেই চলবে)
const createBookServices = async (
  payload: Omit<IBook, 'id'>
): Promise<IBook> => {
  const data: any = { ...payload };

  const lastBook = await Book.findOne().sort({ id: -1 });
  const nextId = lastBook ? lastBook.id + 1 : 1;
  data.id = nextId;

  // Auto slug from title when missing; append the id if that slug is taken.
  if (!data.slug || !String(data.slug).trim()) {
    const base = slugify(data.title) || `book-${nextId}`;
    const exists = await Book.findOne({ slug: base });
    data.slug = exists ? `${base}-${nextId}` : base;
  }

  const newBook = await Book.create(data);
  return newBook;
};

// READ → সব বই রিটার্ন (with search, filter, sort, pagination)
const getAllBooksServices = async (query?: {
  search?: string;
  category?: string;
  language?: string;
  format?: string;
  status?: string;
  sort?: string;
  page?: number;
  limit?: number;
  publicOnly?: boolean;
}): Promise<{ books: IBook[]; total: number; page: number; totalPages: number }> => {
  const filter: any = {};
  const {
    search, category, language, format, status,
    sort = 'newest', page = 1, limit = 50,
    publicOnly = false,
  } = query || {};

  // Combine status + search with $and so one $or doesn't overwrite the other
  // (search must not wipe the published-only filter → drafts leaking publicly).
  const and: any[] = [];

  // Status filter — public API shows only published (or books without status field)
  if (publicOnly) {
    and.push({ $or: [{ status: 'published' }, { status: { $exists: false } }] });
  } else if (status && status !== 'all') {
    filter.status = status;
  }
  // status === 'all' → no filter, show everything

  // Category filter
  if (category) filter.category = category;

  // Language filter
  if (language) filter.language = language;

  // Format filter (printed / digital)
  if (format) filter.format = format;

  // Search
  if (search) {
    and.push({
      $or: [
        { title: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ],
    });
  }

  if (and.length) filter.$and = and;

  // Sort options
  let sortOption: any = { _id: -1 };
  switch (sort) {
    case 'newest': sortOption = { createdAt: -1 }; break;
    case 'oldest': sortOption = { createdAt: 1 }; break;
    case 'price_low': sortOption = { price: 1 }; break;
    case 'price_high': sortOption = { price: -1 }; break;
    case 'popular': sortOption = { totalSold: -1 }; break;
    case 'rating': sortOption = { rating: -1 }; break;
  }

  const total = await Book.countDocuments(filter);
  // secureFileUrl is select:false on the schema → never returned in listings.
  const books = await Book.find(filter)
    .sort(sortOption)
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    books,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

// Resolve a book by slug, numeric `id`, OR Mongo _id — the public site links by
// slug (/books/anatomy-basics) while the admin edit form may use _id. A single
// $or query avoids CastErrors on a non-ObjectId param.
// secureFileUrl stays hidden here too (select:false) — only preview is public.
const getSingleBookServices = async (slugOrId: string) => {
  const or: Record<string, unknown>[] = [{ slug: slugOrId }];
  if (!isNaN(Number(slugOrId))) or.push({ id: Number(slugOrId) });
  if (isValidObjectId(slugOrId)) or.push({ _id: slugOrId });
  return await Book.findOne({ $or: or });
};

// UPDATE → মঙ্গোডিবি _id দিয়ে আপডেট
const updateBookServices = async (id: string, payload: any) => {
  return await Book.findByIdAndUpdate(id, payload, { new: true });
};

// DELETE → মঙ্গোডিবি _id দিয়ে ডিলিট
const deleteBookServices = async (id: string): Promise<IBook | null> => {
  return await Book.findByIdAndDelete(id);
};

// সব সার্ভিস এক্সপোর্ট করা হচ্ছে
export const BookService = {
  createBookServices,
  getAllBooksServices,
  getSingleBookServices,
  updateBookServices,
  deleteBookServices,
};
