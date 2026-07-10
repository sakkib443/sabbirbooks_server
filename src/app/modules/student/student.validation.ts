import { z } from 'zod';

// NOTE (adaptation): wrapped in `{ body: ... }` so it works with this project's
// validateRequest (which parses { body, params, query }). The reference server's
// schema was a bare object, which would not validate correctly here.
export const studentValidationSchema = z.object({
  body: z.object({
    id: z.string(),
    name: z.string(),
    gender: z.enum(['male', 'female', 'other']),
    dateOfBirth: z.string(),
    email: z.string().email(),
    contactNo: z.string(),
    emergencyContact: z.string(),
    address: z.string(),
    guardian: z.string(),
    profileImg: z.string().optional(),
    courseName: z.string(),
  }),
});
