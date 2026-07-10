import { z } from 'zod';

// Zod Validation: API তে ডাটা আসার সময় চেক করার জন্য
// শুধু name লাগবে — id backend-এ অটো সিরিয়ালি তৈরি হয়
export const categoryValidationSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
  }),
});
