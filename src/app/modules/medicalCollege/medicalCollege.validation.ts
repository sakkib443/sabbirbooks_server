import { z } from 'zod';

const body = z.object({
  name: z.string().min(2, 'College name is required'),
  type: z.enum(['government', 'private', 'army']),
  division: z.string().min(1, 'Division is required'),
  district: z.string().min(1, 'District is required'),
  area: z.string().optional(),
  established: z.number().int().min(1800).max(2100).optional(),
  seats: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
  needsReview: z.boolean().optional(),
});

export const createCollegeValidationSchema = z.object({ body });

// Partial so the admin can fix one field without resending the row.
export const updateCollegeValidationSchema = z.object({ body: body.partial() });
