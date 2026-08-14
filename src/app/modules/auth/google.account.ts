// src/app/modules/auth/google.account.ts
//
// "Given a proven Google identity and whatever account we already hold for it,
//  what should happen?" — and nothing else.
//
// Deliberately PURE: no mongoose import, no config import, no I/O. The service
// does the two database calls around it. That split exists so this decision —
// the part that decides who gets in and with what role — can be tested
// exhaustively with plain objects, against a live production DATABASE_URL that
// must never be touched.
//
// The one rule that matters most: `role` is written exactly once, as the
// literal 'student', on the create path. It is never read from the token, never
// copied from a request, and never touched on the link path. There is no input
// to this function that can produce an elevated account.

import type { GoogleIdentity } from './google.verify';

/** The subset of a User document this decision reads. */
export interface ExistingAccount {
  email?: string;
  /** '' or absent means the account has no password — Google-only. */
  password?: string;
  googleId?: string;
  authProvider?: string;
  image?: string;
  status?: string;
  isDeleted?: boolean;
  role?: string;
}

/** Fields written when linking Google to an account we already have. */
export interface GoogleAccountUpdates {
  googleId?: string;
  authProvider?: 'google';
  image?: string;
}

/** The document created for a first-time Google user. */
export interface GoogleAccountDraft {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: '';
  password: '';
  role: 'student';
  status: 'active';
  isDeleted: false;
  isPasswordChanged: false;
  image: string;
  googleId: string;
  authProvider: 'google';
}

export type GoogleAccountDecision =
  | { kind: 'reject'; status: number; message: string }
  /** Sign the existing user in. `updates` may be empty — nothing to write. */
  | { kind: 'link'; updates: GoogleAccountUpdates }
  | { kind: 'create'; draft: GoogleAccountDraft };

/**
 * @param existing the account found by googleId, else by verified email, else
 *                 null. Pass the row EVEN IF it is soft-deleted or blocked —
 *                 filtering those out in the query would make this function
 *                 think the address is free and try to create a duplicate.
 * @param identity output of verifyGoogleIdToken — already proven.
 */
export const decideGoogleAccount = (
  existing: ExistingAccount | null | undefined,
  identity: GoogleIdentity,
): GoogleAccountDecision => {
  // ── First-time Google user ──
  if (!existing) {
    return {
      kind: 'create',
      draft: {
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        phoneNumber: '',
        // No password at all, rather than a random one: an empty password can
        // never satisfy bcrypt.compare, so this account genuinely cannot be
        // signed into with the password form.
        password: '',
        // Hardcoded. See the file header.
        role: 'student',
        status: 'active',
        isDeleted: false,
        isPasswordChanged: false,
        image: identity.image,
        googleId: identity.googleId,
        authProvider: 'google',
      },
    };
  }

  // ── Deleted / blocked accounts do not get a side door ──
  // Google sign-in must be exactly as closed as the password form, which
  // rejects `isDeleted` and anything whose status is not 'active'.
  if (existing.isDeleted === true) {
    return {
      kind: 'reject',
      status: 403,
      message: 'This account has been removed. Please contact support.',
    };
  }

  if (existing.status === 'blocked') {
    return {
      kind: 'reject',
      status: 403,
      message: 'This account is blocked. Please contact support.',
    };
  }

  if (existing.status !== 'active') {
    // 'pending', or anything a future migration introduces. Default closed.
    return {
      kind: 'reject',
      status: 403,
      message: 'This account is not active yet. Please contact support.',
    };
  }

  // ── A DIFFERENT Google account claiming an address we have already linked ──
  // Both tokens are verified, so this is not necessarily an attack (a Workspace
  // address can be deleted and re-created under a new `sub`), but silently
  // re-pointing an account at a new Google identity is a transfer of ownership
  // that should be a human decision, not an implicit one.
  if (existing.googleId && existing.googleId !== identity.googleId) {
    return {
      kind: 'reject',
      status: 409,
      message:
        'This email is already linked to a different Google account. Log in with your password, or contact support.',
    };
  }

  // ── Link and sign in ──
  const updates: GoogleAccountUpdates = {};

  if (!existing.googleId) updates.googleId = identity.googleId;

  // Only relabel an account that has no password. A local account that gains a
  // Google link keeps authProvider 'local' on purpose: it can still be signed
  // into with its password, and flipping the label would misreport that.
  if (!existing.password && existing.authProvider !== 'google') {
    updates.authProvider = 'google';
  }

  // Fill an empty avatar, never overwrite one the user already has.
  if (!existing.image && identity.image) updates.image = identity.image;

  return { kind: 'link', updates };
};
