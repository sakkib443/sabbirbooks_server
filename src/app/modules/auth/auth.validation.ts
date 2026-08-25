// src/app/modules/auth/auth.validation.ts
import { z } from 'zod';

// Login by EMAIL or PHONE (+ password). At least one identifier is required.
export const loginValidationSchema = z.object({
  body: z
    .object({
      email: z.string().optional(),
      phone: z.string().optional(),
      identifier: z.string().optional(),
      password: z.string().min(1, { message: 'Password is required' }),
    })
    .refine((d) => Boolean(d.email || d.phone || d.identifier), {
      message: 'Email or phone number is required',
      path: ['email'],
    }),
});

// Public registration (student). Mirrors the user module's signup schema.
export const registerValidationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, { message: 'First name is required' }),
    lastName: z.string().min(1, { message: 'Last name is required' }),
    email: z.string().email({ message: 'Valid email is required' }),
    phoneNumber: z.string().optional(),
    // Every customer is reached on WhatsApp, so the shop asks for it up front.
    // Bangladeshi mobiles only: 11 digits starting 01, optionally carrying a
    // +88 / 88 country prefix. Kept in step with the identical rule in
    // user.validation.ts — the two signup schemas must not drift.
    whatsappNumber: z
      .string()
      .trim()
      .regex(/^(?:\+?88)?01[3-9]\d{8}$/, {
        message: 'Give a valid WhatsApp number, e.g. 01712345678',
      }),
    // Directory id when the student picked from the list. The free-text name is
    // what they typed when their college was not in the directory yet.
    medicalCollege: z.string().optional(),
    medicalCollegeName: z.string().optional(),
    location: z.string().optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    password: z
      .string()
      .min(4, { message: 'Password should be at least 4 characters' })
      .max(20, { message: 'Password should not exceed 20 characters' }),
  }),
});
