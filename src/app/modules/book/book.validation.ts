import { z } from 'zod';

// ─── Book body schema ────────────────────────────────────────
// id backend-এ অটো সিরিয়ালি তৈরি হয় — তাই এখানে লাগে না।
// printed বইয়ে stock, digital বইয়ে secureFileUrl বাধ্যতামূলক।
const bookBodySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  slug: z.string().min(1, 'Slug is required'),
  author: z.string().min(1, 'Author is required'),
  description: z.string().min(1, 'Description is required'),
  coverImage: z.string().url('Cover image must be a valid URL'),

  price: z.number().min(0, 'Price must be 0 or more'),
  offerPrice: z.number().min(0).optional(),

  category: z.string().min(1, 'Category is required'),

  language: z.enum(['bn', 'en', 'both']).default('both'),
  format: z.enum(['printed', 'digital']),

  stock: z.number().min(0).optional(),
  secureFileUrl: z.string().url('Secure file must be a valid URL').optional(),

  previewImages: z.array(z.string().url('Preview image must be a valid URL')).optional(),
  previewPdfUrl: z.string().url('Preview PDF must be a valid URL').optional(),

  status: z.enum(['draft', 'published', 'archived']).optional(),
  isFeatured: z.boolean().default(false),

  rating: z.number().min(0).max(5).optional(),
  totalSold: z.number().min(0).optional(),
});

// CREATE — format অনুযায়ী conditional required ফিল্ড চেক
const createBookBodySchema = bookBodySchema.superRefine((data, ctx) => {
  if (data.format === 'printed') {
    if (data.stock === undefined || data.stock < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stock'],
        message: 'Stock is required for printed books',
      });
    }
  }
  if (data.format === 'digital') {
    if (!data.secureFileUrl || data.secureFileUrl.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secureFileUrl'],
        message: 'Secure file URL is required for digital books',
      });
    }
  }
});

// validateRequest middleware parses { body, params, query } — তাই body wrapper লাগবে
export const createBookValidationSchema = z.object({
  body: createBookBodySchema,
});

// UPDATE — সব ফিল্ড optional (partial update)
export const updateBookValidationSchema = z.object({
  body: bookBodySchema.partial(),
});
