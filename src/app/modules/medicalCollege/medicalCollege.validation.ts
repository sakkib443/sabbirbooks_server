import { z } from 'zod';

const body = z.object({
  name: z.string().min(2, 'College name is required'),
  type: z.enum(['government', 'private', 'army']),
  university: z.string().max(120).optional(),
  division: z.string().min(1, 'Division is required'),
  district: z.string().min(1, 'District is required'),
  area: z.string().optional(),
  upazila: z.string().max(80).optional(),
  established: z.number().int().min(1800).max(2100).optional(),
  seats: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
  needsReview: z.boolean().optional(),
});

export const createCollegeValidationSchema = z.object({ body });

// Partial so the admin can fix one field without resending the row.
export const updateCollegeValidationSchema = z.object({ body: body.partial() });

// The delivery-charge screen. A rate is money, so it has its own route behind
// settings.write rather than riding along with the directory edit above, which
// a manager can reach. null clears the rate back to the standard charge.
export const updateCollegeDeliveryValidationSchema = z.object({
  body: z.object({
    deliveryCharge: z.number().int().min(0).max(100000).nullable().optional(),
    upazila: z.string().max(80).optional(),
  }),
});
