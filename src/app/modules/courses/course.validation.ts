import { z } from "zod";

// ─── Course body schema ──────────────────────────────────────
// Online/Offline (Live) কোর্সে courseStart, durationMonth, curriculum লাগবে;
// Recorded কোর্সে এগুলো লাগে না (Modules & Lessons আলাদাভাবে যোগ হয়)।
const courseBodySchema = z
  .object({
    id: z.number(),
    title: z.string().min(1, "Title is required"),
    slug: z.string().min(1, "Slug is required"),

    // category কে ObjectId হিসেবে নেবে (string with length validation)
    category: z.string().min(1, "Category is required"),

    type: z.enum(["Online", "Offline", "Recorded"]),
    status: z.enum(["draft", "published", "archived"]).optional(),
    image: z.string().url("Image must be a valid URL"),
    fee: z.string().min(1, "Fee is required"),
    offerPrice: z.string().optional(),
    admissionFee: z.number().min(0).optional(),
    rating: z.number().min(0).max(5).default(4.7),
    totalRating: z.number().min(0).default(28),
    totalStudentsEnroll: z.number().min(0).default(260),

    // Mentor কে ObjectId হিসেবে নেবে (string with length validation)
    mentor: z.string().min(1, "Mentor ID is required"),

    technology: z.string().min(1, "Technology is required"),
    courseStart: z.string().optional(),
    durationMonth: z.number().optional(),
    curriculum: z.array(z.string().min(1)).optional(),

    lectures: z.number().min(0),
    totalExam: z.number().min(0).default(0),
    totalProject: z.number().min(0).default(0),
    details: z.string().min(1, "Details are required"),
    courseOverview: z.string().min(1, "Course overview is required"),
    courseIncludes: z.array(
      z.object({
        icon: z.string().min(1),
        text: z.string().min(1),
      })
    ),
    softwareYoullLearn: z.array(z.string().min(1)),
    jobPositions: z.array(z.string().min(1)),
  })
  .superRefine((data, ctx) => {
    // Live কোর্সে (Online/Offline) এই ফিল্ডগুলো বাধ্যতামূলক
    if (data.type !== "Recorded") {
      if (!data.courseStart || data.courseStart.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["courseStart"],
          message: "Course start is required for Online/Offline courses",
        });
      }
      if (!data.durationMonth || data.durationMonth < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["durationMonth"],
          message: "Duration (months) is required for Online/Offline courses",
        });
      }
      if (!data.curriculum || data.curriculum.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["curriculum"],
          message: "At least one curriculum topic is required for Online/Offline courses",
        });
      }
    }
  });

// validateRequest middleware parses { body, params, query } — তাই body wrapper লাগবে
export const courseValidationSchema = z.object({
  body: courseBodySchema,
});
