import { z } from 'zod';

// ─── Content block schema ────────────────────────────────────
// value = text body / image URL / video URL depending on `type`.
const blockSchema = z.object({
  type: z.enum(['text', 'image', 'video']),
  value: z.string().min(1, 'Block value is required'),
  caption: z.string().optional(),
});

// questionNo may arrive as a string label ("12a") or a JSON number — accept both.
const questionNoSchema = z.union([
  z.string().min(1, 'Question number is required'),
  z.number(),
]);

// ─── QrResource body schema ──────────────────────────────────
// slug is optional on the wire — backend auto-generates a unique one when omitted.
const qrResourceBodySchema = z.object({
  slug: z.string().optional(),
  book: z.string().optional(),
  bookTitle: z.string().optional(),
  questionNo: questionNoSchema,
  questionText: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  blocks: z.array(blockSchema).optional(),
  status: z.enum(['draft', 'published']).optional(),
});

// validateRequest middleware parses { body, params, query } — তাই body wrapper লাগবে
export const createQrResourceValidationSchema = z.object({
  body: qrResourceBodySchema,
});

// UPDATE — সব ফিল্ড optional (partial update)
export const updateQrResourceValidationSchema = z.object({
  body: qrResourceBodySchema.partial(),
});
