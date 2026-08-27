import { z } from 'zod';

// One named offer — normal / pre-order / online-payment. All parts optional so a
// partial edit (just flip `enabled`, say) is accepted; percent is capped to match
// the schema and the pricing clamp, and `amount` is the fixed-taka alternative.
const bookOfferSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().optional(),
  type: z.enum(['percent', 'fixed']).optional(),
  percent: z.number().min(0).max(90).optional(),
  amount: z.number().min(0).optional(),
});

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

  // ── Offers (named discounts) ──
  // Each block is optional; percent mirrors the schema/pricing cap of 90. Must be
  // declared here for the same reason the pre-order fields are — validateRequest
  // forwards the raw body, and Mongoose drops anything strict mode does not know.
  offers: z
    .object({
      normal: bookOfferSchema.optional(),
      preorder: bookOfferSchema.optional(),
      online: bookOfferSchema.optional(),
    })
    .optional(),

  // ── Pre-order ──
  // These MUST be listed here even though they are all optional: validateRequest
  // discards zod's parsed output and forwards the raw body, so an unlisted field
  // is not stripped — it reaches Mongoose, which drops it silently under strict
  // mode. A field missing from this schema half-works, which is worse than either.
  isPreOrder: z.boolean().optional(),
  preOrderDiscountPercent: z.number().min(0).max(90).optional(),
  preOrderNote: z.string().optional(),
  // An ISO date string from the admin form; null/'' when the admin clears it.
  expectedReleaseDate: z.union([z.string(), z.null()]).optional(),

  // ── Landing page content ──
  // Not .url(): this is either a YouTube link or a path to an uploaded file.
  promoVideoUrl: z.string().optional(),
  features: z
    .array(
      z.object({
        text: z.string().min(1),
        weight: z.number().optional(),
        highlight: z.boolean().optional(),
      })
    )
    .optional(),

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
