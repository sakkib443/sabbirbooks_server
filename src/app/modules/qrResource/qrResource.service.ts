/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import { QrResource } from './qrResource.model';
import { IQrResource } from './qrResource.interface';

// Normalise an admin-provided slug into a clean, URL-safe key.
const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Short random slug (10 hex chars) — used when the admin doesn't supply one.
const makeSlug = (): string => crypto.randomBytes(5).toString('hex');

// Guarantee slug uniqueness against the collection. Collisions are astronomically
// rare, so we retry a handful of times, then fall back to a full UUID.
const generateUniqueSlug = async (): Promise<string> => {
  for (let i = 0; i < 5; i++) {
    const candidate = makeSlug();
    const exists = await QrResource.exists({ slug: candidate });
    if (!exists) return candidate;
  }
  return crypto.randomUUID().replace(/-/g, '');
};

// CREATE → auto-generate a unique slug when none is provided (or normalise the
// admin-supplied one). questionNo is stored as a string.
const createQrResourceServices = async (payload: any): Promise<IQrResource> => {
  const data = { ...payload };

  if (data.questionNo !== undefined) data.questionNo = String(data.questionNo);

  const provided = typeof data.slug === 'string' ? slugify(data.slug) : '';
  data.slug = provided || (await generateUniqueSlug());

  const created = await QrResource.create(data);
  return created;
};

// READ (admin) → paginated list with search by book / questionNo / title.
const getAllQrResourcesServices = async (query?: {
  search?: string;
  book?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ resources: IQrResource[]; total: number; page: number; totalPages: number }> => {
  const { search, book, status, page = 1, limit = 20 } = query || {};
  const filter: any = {};
  const and: any[] = [];

  // Status filter (draft / published); 'all' → no filter.
  if (status && status !== 'all') filter.status = status;

  // Filter by a specific book (only when a valid ObjectId is supplied).
  if (book && isValidObjectId(book)) filter.book = book;

  // Search across question number, headings, book title, question text, slug.
  if (search) {
    and.push({
      $or: [
        { questionNo: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { bookTitle: { $regex: search, $options: 'i' } },
        { questionText: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ],
    });
  }

  if (and.length) filter.$and = and;

  const total = await QrResource.countDocuments(filter);
  const resources = await QrResource.find(filter)
    .populate('book', 'title slug')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    resources,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};

// PUBLIC → published resource by slug; atomically increments `views`.
// Returns null when the slug doesn't exist or the resource isn't published
// (drafts never leak to the public QR endpoint).
const getPublicQrResourceBySlug = async (slug: string) => {
  return await QrResource.findOneAndUpdate(
    { slug, status: 'published' },
    { $inc: { views: 1 } },
    { new: true }
  ).populate('book', 'title slug author coverImage');
};

// ADMIN → fetch one by _id for editing (any status, no view increment).
const getQrResourceByIdServices = async (id: string) => {
  return await QrResource.findById(id).populate('book', 'title slug');
};

// UPDATE → by _id. Re-slugify an admin-edited slug; never overwrite with empty,
// and never let `views` be set through the update body (it's server-managed).
const updateQrResourceServices = async (id: string, payload: any) => {
  const data = { ...payload };

  if (data.slug !== undefined) {
    const clean = slugify(String(data.slug));
    if (clean) data.slug = clean;
    else delete data.slug;
  }
  if (data.questionNo !== undefined) data.questionNo = String(data.questionNo);
  delete data.views;

  return await QrResource.findByIdAndUpdate(id, data, { new: true });
};

// DELETE → by _id.
const deleteQrResourceServices = async (id: string): Promise<IQrResource | null> => {
  return await QrResource.findByIdAndDelete(id);
};

export const QrResourceService = {
  createQrResourceServices,
  getAllQrResourcesServices,
  getPublicQrResourceBySlug,
  getQrResourceByIdServices,
  updateQrResourceServices,
  deleteQrResourceServices,
};
