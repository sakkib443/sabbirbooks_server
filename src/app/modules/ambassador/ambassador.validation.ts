import { z } from 'zod';

const url = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    // Accepts a bare "facebook.com/…" as well as a full URL — people paste both,
    // and refusing the shorter one loses applications for no benefit.
    .refine((v) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v), `${label} looks invalid`);

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .refine(
    (v) => !v || /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v),
    'Link looks invalid'
  );

const phone = z
  .string({ required_error: 'Phone number is required' })
  .trim()
  .regex(/^01[3-9]\d{8}$/, 'Enter an 11-digit Bangladeshi mobile number (01XXXXXXXXX)');

/**
 * The six agreement boxes.
 *
 * Every one is `literal(true)` rather than a single "I agree": the shop's form
 * lists six separate undertakings, and a submission that ticked four of them is
 * not the agreement they were asked to make. The client cannot submit without
 * all six either, but that is a courtesy — this is the part that holds.
 */
const agreement = z.object({
  accurateInfo: z.literal(true, { errorMap: () => ({ message: 'Please accept all six terms' }) }),
  approvalRequired: z.literal(true, { errorMap: () => ({ message: 'Please accept all six terms' }) }),
  responsibleUse: z.literal(true, { errorMap: () => ({ message: 'Please accept all six terms' }) }),
  honestPromotion: z.literal(true, { errorMap: () => ({ message: 'Please accept all six terms' }) }),
  noFalseClaims: z.literal(true, { errorMap: () => ({ message: 'Please accept all six terms' }) }),
  shopMayTerminate: z.literal(true, { errorMap: () => ({ message: 'Please accept all six terms' }) }),
});

export const applyValidationSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2, 'Full name is required'),
    phone,
    whatsapp: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^01[3-9]\d{8}$/.test(v), 'Enter a valid WhatsApp number'),
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    facebookUrl: url('Facebook profile link'),
    instagramUrl: optionalUrl,

    medicalCollege: z.string().trim().optional(),
    medicalCollegeName: z.string().trim().min(2, 'Medical college is required'),
    batch: z.string().trim().min(1, 'Batch is required'),
    academicYear: z.enum(['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Intern'], {
      errorMap: () => ({ message: 'Select your current year' }),
    }),
    city: z.string().trim().min(1, 'City is required'),
    idCardUrl: z.string().trim().optional(),

    reach: z.enum(['<25', '25-50', '50-100', '100-200', '200-300', '300+'], {
      errorMap: () => ({ message: 'Select how many students you can reach' }),
    }),
    promoteChannels: z
      .array(
        z.enum([
          'facebook-profile',
          'facebook-groups',
          'batch-groups',
          'messenger-groups',
          'whatsapp-groups',
          'instagram',
          'classmates',
          'campus-community',
          'other',
        ])
      )
      .min(1, 'Select at least one place you can promote'),
    promoteChannelOther: z.string().trim().max(200).optional(),
    isGroupAdmin: z.boolean().default(false),

    hasPriorExperience: z.boolean().default(false),
    experienceNote: z.string().trim().max(2000).optional(),

    comfortableSharingContent: z.boolean().default(true),
    suggestions: z.string().trim().max(2000).optional(),

    agreement,
  }),
});

export const reviewValidationSchema = z.object({
  body: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'suspended']),
    adminNote: z.string().trim().max(2000).optional(),
  }),
});

export const noteValidationSchema = z.object({
  body: z.object({
    adminNote: z.string().trim().max(2000),
  }),
});
