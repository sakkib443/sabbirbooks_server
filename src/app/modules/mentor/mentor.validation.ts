import { z } from 'zod';

// validateRequest middleware parses { body, params, query } — তাই body wrapper লাগবে
const mentorBodySchema = z.object({
  id: z.string().min(1, 'ID is required'),

  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().min(1, 'Phone number is required'),

  designation: z.string().min(1, 'Designation is required'),

  subject: z.string().min(1, 'Subject is required'),

  specialized_area: z
    .array(z.string().min(1))
    .nonempty('At least one specialized area is required'),

  education_qualification: z
    .array(z.string().min(1))
    .nonempty('At least one education qualification is required'),

  work_experience: z
    .array(z.string().min(1))
    .nonempty('At least one work experience is required'),

  training_experience: z.object({
    years: z.string().min(1, 'Training experience years is required'),
    students: z.string().min(1, 'Trained students count is required'),
  }),

  image: z.string().url('Valid image URL is required'),

  details: z.string().min(1, 'Details is required'),

  lifeJourney: z.string().min(1, 'Life journey is required'),

  // Optional login password for the auto-created mentor user (blank → default).
  password: z.string().optional(),
  // Public-website visibility (defaults to true when omitted).
  isPublished: z.boolean().optional(),
});

export const mentorValidationSchema = z.object({
  body: mentorBodySchema,
});
