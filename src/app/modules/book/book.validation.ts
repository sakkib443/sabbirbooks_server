import { z } from 'zod';

// ─── Book body schema (simplified) ───────────────────────────
// Only `title` is required. id/slug are auto-filled by the service; every other
// field is optional so a book can be added with minimal input and finished later.
const bookBodySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  slug: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  coverImage: z.string().url('Cover image must be a valid URL').optional().or(z.literal('')),

  price: z.number().min(0, 'Price must be 0 or more').optional(),
  offerPrice: z.number().min(0).optional(),

  category: z.string().optional(),

  language: z.enum(['bn', 'en', 'both']).optional(),
  format: z.enum(['printed', 'digital']).optional(),

  stock: z.number().min(0).optional(),
  secureFileUrl: z.string().url('Secure file must be a valid URL').optional().or(z.literal('')),

  previewImages: z.array(z.string().url('Preview image must be a valid URL')).optional(),
  previewPdfUrl: z.string().url('Preview PDF must be a valid URL').optional().or(z.literal('')),

  status: z.enum(['draft', 'published', 'archived']).optional(),
  isFeatured: z.boolean().optional(),

  rating: z.number().min(0).max(5).optional(),
  totalSold: z.number().min(0).optional(),
});

// validateRequest middleware parses { body, params, query } — তাই body wrapper লাগবে
export const createBookValidationSchema = z.object({
  body: bookBodySchema,
});

// UPDATE — সব ফিল্ড optional (partial update)
export const updateBookValidationSchema = z.object({
  body: bookBodySchema.partial(),
});
