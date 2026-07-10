import { z } from "zod";

export const signupValidationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, { message: "First name is required" }),
    lastName: z.string().min(1, { message: "Last name is required" }),
    email: z.string().email({ message: "Valid email is required" }),
    phoneNumber: z.string().optional(),
    location: z.string().optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    password: z
      .string()
      .min(4, { message: "Password should be at least 4 characters" })
      .max(20, { message: "Password should not exceed 20 characters" }),
    // Public signup can ONLY create students — a privileged role is never accepted here
    role: z.enum(['student']).optional().default('student'),
    status: z.enum(['active', 'pending']).optional().default('active'),
  }),
});

// Staff (admin / trainingManager) created by an admin from the dashboard
export const createStaffValidationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, { message: 'First name is required' }),
    lastName: z.string().optional().default(''),
    email: z.string().email({ message: 'Valid email is required' }),
    phoneNumber: z.string().optional(),
    password: z.string().min(6, { message: 'Password should be at least 6 characters' }),
    role: z.enum(['admin', 'trainingManager']),
  }),
});

// Student created by an admin / superAdmin / trainingManager from the dashboard (role forced to 'student')
export const createStudentValidationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, { message: 'First name is required' }),
    lastName: z.string().optional().default(''),
    email: z.string().email({ message: 'Valid email is required' }),
    phoneNumber: z.string().optional(),
    password: z.string().min(6, { message: 'Password should be at least 6 characters' }),
  }),
});

export const googleLoginValidationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1),
    lastName: z.string().optional().default(''),
    email: z.string().email(),
    image: z.string().optional(),
    googleId: z.string().min(1),
  }),
});

// Keep old schema for backward compat
export const userValidationSchema = z.object({
  body: z.object({
    id: z.string().min(1, { message: "ID is required" }).optional(),
    password: z
      .string()
      .min(4, { message: "Password should be at least 4 characters" })
      .max(20, { message: "Password should not exceed 20 characters" }),
    isPasswordChanged: z.boolean().optional(),
    role: z.enum(['superAdmin', 'admin', 'trainingManager', 'mentor', 'student']),
    status: z.enum(['active', 'blocked', 'pending']).optional(),
    isDeleted: z.boolean().optional(),
  }),
});
