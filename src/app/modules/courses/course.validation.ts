import { z } from "zod";

// ─── Course body schema (simplified for medical courses) ─────
// Only `title` is required. The service fills in id/slug/type when omitted,
// and every other field is optional so a course can be uploaded with minimal
// input and fleshed out later. IT-bootcamp fields were removed.
const courseBodySchema = z.object({
  id: z.number().optional(),
  title: z.string().min(1, "Title is required"),
  slug: z.string().optional(),

  // category / mentor — optional ObjectId references
  category: z.string().optional(),
  mentor: z.string().optional(),

  type: z.enum(["Online", "Offline", "Recorded"]).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  image: z.string().url("Image must be a valid URL").optional().or(z.literal("")),
  fee: z.string().optional(),
  offerPrice: z.string().optional(),
  admissionFee: z.number().min(0).optional(),
  rating: z.number().min(0).max(5).optional(),
  totalRating: z.number().min(0).optional(),
  totalStudentsEnroll: z.number().min(0).optional(),

  courseStart: z.string().optional(),
  durationMonth: z.number().optional(),
  curriculum: z.array(z.string()).optional(),

  lectures: z.number().min(0).optional(),
  totalExam: z.number().min(0).optional(),
  details: z.string().optional(),
  courseOverview: z.string().optional(),
  courseIncludes: z
    .array(
      z.object({
        icon: z.string().optional(),
        text: z.string().optional(),
      })
    )
    .optional(),
});

// validateRequest middleware parses { body, params, query } — তাই body wrapper লাগবে
export const courseValidationSchema = z.object({
  body: courseBodySchema,
});
