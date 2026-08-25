import { z } from "zod";
import { GRANTABLE_CAPABILITIES, ROLES } from "../../config/permissions";

// zod's enum() wants a non-empty tuple; the shared lists are readonly arrays.
const roleEnum = z.enum(ROLES as unknown as [string, ...string[]]);
const grantableCapability = z.enum(
  GRANTABLE_CAPABILITIES as unknown as [string, ...string[]],
);

export const signupValidationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, { message: "First name is required" }),
    lastName: z.string().min(1, { message: "Last name is required" }),
    email: z.string().email({ message: "Valid email is required" }),
    phoneNumber: z.string().optional(),
    // Kept identical to the rule in auth.validation.ts — both schemas guard a
    // public student signup, and letting them drift means one door enforces the
    // number and the other does not.
    whatsappNumber: z
      .string()
      .trim()
      .regex(/^(?:\+?88)?01[3-9]\d{8}$/, {
        message: "Give a valid WhatsApp number, e.g. 01712345678",
      }),
    medicalCollege: z.string().optional(),
    medicalCollegeName: z.string().optional(),
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

// Staff (admin / trainingManager / contentManager / manager) created by an admin from the dashboard
export const createStaffValidationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, { message: 'First name is required' }),
    lastName: z.string().optional().default(''),
    email: z.string().email({ message: 'Valid email is required' }),
    phoneNumber: z.string().optional(),
    password: z.string().min(6, { message: 'Password should be at least 6 characters' }),
    role: z.enum(['admin', 'trainingManager', 'contentManager', 'manager']),
    // Optional starting permission set for a manager. Omit it and the role's
    // defaults apply. 'staff.manage' is not in the grantable list, so it can
    // never be requested here.
    permissions: z.array(grantableCapability).optional(),
  }),
});

// Replace a manager's capability list (PATCH /api/user/:id/permissions)
export const setPermissionsValidationSchema = z.object({
  body: z.object({
    permissions: z.array(grantableCapability),
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

// Sign in with Google (POST /api/user/google-signin).
//
// ONE field, and it is not an identity — it is Google's signed ID token. The
// schema this replaced accepted { firstName, email, googleId } and every one of
// those was a claim the caller made about themselves; the endpoint believed all
// three. Nothing here is believed: the token is verified against Google's
// signing keys in modules/auth/google.verify.ts and the identity is read out of
// the verified payload. Do not add name/email/id fields back to this schema —
// the server has no use for them and reading them would reopen the hole.
//
// The length floor is a cheap sanity gate, not a security control: a real ID
// token is a three-part JWT well over 500 characters.
export const googleSignInValidationSchema = z.object({
  body: z.object({
    credential: z
      .string()
      .min(20, { message: 'A Google ID token is required' })
      .max(8192, { message: 'Google ID token is too large' }),
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
    role: roleEnum,
    status: z.enum(['active', 'blocked', 'pending']).optional(),
    isDeleted: z.boolean().optional(),
  }),
});
