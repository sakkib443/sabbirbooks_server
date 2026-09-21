/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/modules/auth/auth.service.ts
import { User } from '../user/user.model';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { SessionService } from '../session/session.service';
import { CAPABILITY_KEYS, MANAGER_ROLES, resolveCapabilities } from '../../config/permissions';
import { generateUserId } from '../user/user.service';
import { verifyGoogleIdToken, GoogleAuthError } from './google.verify';
import { decideGoogleAccount } from './google.account';
import { PasswordEmailService } from '../notification/passwordEmail.service';

/**
 * The account that used to be a backdoor.
 *
 * This file once carried a "master key": an email and password, written here in
 * plain text in a public repository, that logged anyone in as superAdmin — it
 * was checked BEFORE the database, created the account if it was missing and
 * promoted it if it had been demoted. Anyone who had read this file could run
 * the shop. That check is gone; login now goes through the database like every
 * other account.
 *
 * Removing the check does not close the door on its own. If the account was
 * ever used, it exists in the database with that same published password
 * hashed, and the ordinary login path would accept it. So at startup,
 * retireDefaultAdminPassword() looks for exactly that — this email, still on
 * this password — replaces the password with a random one nobody knows, and
 * signs the account out everywhere. An account whose password was already
 * changed is left alone. To use it again, an admin sets a new password for it
 * from the Users screen.
 *
 * The strings stay here only so the startup check can recognise them. They are
 * in this repository's history anyway; what matters is that they no longer
 * open anything.
 */
const RETIRED_DEFAULT_ADMIN = {
  email: 'admin@sabbirbook.com',
  password: 'Admin@123456',
};

interface DeviceContext {
  deviceId?: string;
  userAgent?: string;
  ip?: string;
}

// Helper: Generate tokens
const generateTokens = (payload: { _id: string; role: string; email: string }) => {
  const accessToken = jwt.sign(payload, config.jwt.access_secret, {
    expiresIn: config.jwt.access_expires_in as any,
  });

  const refreshToken = jwt.sign(
    { _id: payload._id, role: payload.role },
    config.jwt.refresh_secret,
    { expiresIn: config.jwt.refresh_expires_in as any }
  );

  return { accessToken, refreshToken };
};

const loginUser = async (
  payload: { email?: string; phone?: string; identifier?: string; password: string },
  device: DeviceContext = {},
) => {
  const { password } = payload;
  // Support login by EMAIL or PHONE — accept `email`, `phone`, or a generic `identifier`.
  const identifier = String(payload.identifier || payload.email || payload.phone || '').trim();

  // Normal user login flow — match by email OR phone number
  const user = await User.findOne({
    $or: [{ email: identifier.toLowerCase() }, { phoneNumber: identifier }],
    isDeleted: false,
  });

  if (!user || user.status !== 'active') {
    throw new Error('User not found or not active');
  }

  const isPasswordMatched = await bcrypt.compare(password, user.password || '');

  if (!isPasswordMatched) {
    throw new Error('Incorrect password');
  }

  const { accessToken, refreshToken } = generateTokens({
    _id: String(user._id),
    role: user.role,
    email: user.email,
  });

  // Device-limit: register/replace this device's session (evicts oldest if over limit).
  const { deviceId } = await SessionService.createSession({
    userId: String(user._id),
    deviceId: device.deviceId,
    refreshToken,
    userAgent: device.userAgent,
    ip: device.ip,
    role: user.role,
  });

  return {
    token: accessToken, // backward compat for existing frontend
    accessToken,
    refreshToken,
    deviceId,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      status: user.status,
      // False for an account whose password was set FOR them and never changed
      // since — a Campus Ambassador starts with their own phone number, which
      // anyone holding their business card can guess. The dashboard reads this
      // to open its change-password card already expanded. It was being written
      // at signup and never sent, so nothing could act on it.
      isPasswordChanged: user.isPasswordChanged !== false,
      // Resolved server-side so the browser never has to work it out. Refreshed
      // on every dashboard mount via GET /api/auth/me.
      capabilities: resolveCapabilities(user.role, user.permissions),
    },
  };
};

// ─── Sign in with Google ────────────────────────────────────────────────────
//
// Replaces the retired /api/user/google-login. The shape of the returned object
// is identical to loginUser()'s so the client can hand it to the same
// persistSession() without a special case.
//
// Three things make this safe where the old endpoint was not:
//   1. The identity comes out of verifyGoogleIdToken() — a Google-signed token,
//      audience-checked, with email_verified proven. Nothing is read from the
//      request body but the token string itself.
//   2. The role comes out of decideGoogleAccount(), which writes the literal
//      'student' on the create path and never touches role on the link path.
//      A brand-new Google user cannot arrive as anything but a student.
//   3. Tokens are minted by generateTokens() above, so they respect
//      config.jwt (12h / 30d) and cannot fall back to a default secret, and
//      the session goes through SessionService so the device limit applies
//      exactly as it does to a password login.
const googleSignIn = async (idToken: unknown, device: DeviceContext = {}) => {
  const identity = await verifyGoogleIdToken(idToken);

  // Look up by the Google subject FIRST: `sub` is stable and never reused,
  // whereas an email address can be reassigned. The email fallback is what
  // links a Google sign-in to an account that was created with a password, and
  // it is only sound because the token's email_verified has already been
  // proven — an unverified address never reaches this line.
  //
  // Neither query filters out isDeleted/blocked rows on purpose: hiding them
  // would make the code believe the address is free and try to insert a
  // duplicate, which the unique email index would reject with a confusing
  // 11000. decideGoogleAccount() turns them into a clear 403 instead.
  const existing =
    (await User.findOne({ googleId: identity.googleId })) ||
    (await User.findOne({ email: identity.email }));

  const decision = decideGoogleAccount(existing, identity);

  if (decision.kind === 'reject') {
    const e: any = new Error(decision.message);
    e.status = decision.status;
    throw e;
  }

  let user = existing;

  if (decision.kind === 'create') {
    user = await User.create({ ...decision.draft, id: await generateUserId() });
  } else if (user && Object.keys(decision.updates).length > 0) {
    Object.assign(user, decision.updates);
    // .save() runs the pre-save hook, which only touches a MODIFIED password —
    // and `updates` never contains one, so no hash is recomputed here.
    await user.save();
  }

  if (!user) {
    // Unreachable: every non-reject branch above assigns one.
    throw new Error('Google sign-in failed');
  }

  const { accessToken, refreshToken } = generateTokens({
    _id: String(user._id),
    role: user.role,
    email: user.email,
  });

  const { deviceId } = await SessionService.createSession({
    userId: String(user._id),
    deviceId: device.deviceId,
    refreshToken,
    userAgent: device.userAgent,
    ip: device.ip,
    role: user.role,
  });

  return {
    isNewUser: decision.kind === 'create',
    token: accessToken, // backward compat, same as loginUser()
    accessToken,
    refreshToken,
    deviceId,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      status: user.status,
      image: user.image,
      capabilities: resolveCapabilities(user.role, user.permissions),
    },
  };
};

// Refresh token → new access token (device session validated)
const refreshAccessToken = async (refreshToken: string, deviceId: string) => {
  let decoded: any;
  try {
    decoded = jwt.verify(refreshToken, config.jwt.refresh_secret) as any;
  } catch (error) {
    const e: any = new Error('Invalid or expired refresh token');
    e.status = 401;
    throw e;
  }

  const user = await User.findById(decoded._id);
  if (!user || user.isDeleted || user.status !== 'active') {
    const e: any = new Error('User not found or inactive');
    e.status = 401;
    throw e;
  }

  // Device-limit enforcement on refresh: a matching session must still exist for
  // this device (same deviceId + refresh-token hash). If it was evicted by a
  // newer device, no session is found → 401 (this device was logged out).
  const ok = await SessionService.validateAndTouchSession(
    String(user._id),
    deviceId,
    refreshToken,
  );
  if (!ok) {
    const e: any = new Error('Session not found for this device. Please log in again.');
    e.status = 401;
    throw e;
  }

  const accessToken = jwt.sign(
    { _id: String(user._id), role: user.role, email: user.email },
    config.jwt.access_secret,
    { expiresIn: config.jwt.access_expires_in as any }
  );

  return { accessToken };
};

// Change password
const changePassword = async (userId: string, currentPassword: string, newPassword: string) => {
  const user = await User.findById(userId);
  if (!user || user.isDeleted) {
    throw new Error('User not found');
  }
  const isMatch = await bcrypt.compare(currentPassword, user.password || '');
  if (!isMatch) {
    throw new Error('Current password is incorrect');
  }
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  // isPasswordChanged is the whole point of the flag and was never being set
  // here, so an account created with a password chosen FOR it — a Campus
  // Ambassador starts with their own phone number — stayed flagged as
  // still-on-the-default no matter how many times they changed it, and the
  // dashboard's "you should change this" card never went away.
  await User.findByIdAndUpdate(userId, {
    password: hashedPassword,
    isPasswordChanged: true,
  });
};

// ─── Password reset by email ─────────────────────────────────
//
// The emailed link IS the verification: a new password can only be set by
// someone holding a token that was sent to the account's own inbox.

/** How long a reset link works. Long enough to find the email, short enough to be stale if leaked. */
const RESET_TTL_MINUTES = 30;
/** A second request inside this window sends nothing — a double-click, or someone flooding an inbox. */
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;
/** And at most this many a rolling hour per address, whatever the timing. */
const RESET_HOURLY_LIMIT = 5;
const resetRequests = new Map<string, { n: number; until: number }>();

const resetThrottled = (email: string): boolean => {
  const now = Date.now();
  const rec = resetRequests.get(email);
  if (!rec || rec.until < now) {
    resetRequests.set(email, { n: 1, until: now + 60 * 60 * 1000 });
    if (resetRequests.size > 5000) {
      for (const [k, v] of resetRequests) if (v.until < now) resetRequests.delete(k);
    }
    return false;
  }
  rec.n += 1;
  return rec.n > RESET_HOURLY_LIMIT;
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Constant-time comparison of two hex digests, so the check leaks nothing through its timing. */
const sameHash = (a: string, b: string): boolean => {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The one rule every newly chosen password meets, however it is being set. */
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const assertNewPassword = (pw: unknown): string => {
  const s = String(pw ?? '');
  if (s.length < PASSWORD_MIN || s.length > PASSWORD_MAX) {
    const e: any = new Error(
      `পাসওয়ার্ড ${PASSWORD_MIN} থেকে ${PASSWORD_MAX} অক্ষরের হতে হবে। (Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.)`
    );
    e.status = 400;
    throw e;
  }
  return s;
};

/**
 * "Forgot password" — email a single-use link.
 *
 * Says nothing about whether the address has an account. The caller always
 * answers the same "if an account exists, a link is on its way", so this
 * cannot be used to find out who is a customer. For the same reason every
 * refusal below — no such account, blocked account, too many requests — is
 * silent rather than an error.
 */
const requestPasswordReset = async (emailRaw: unknown): Promise<void> => {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return;
  if (resetThrottled(email)) return;

  const user: any = await User.findOne({ email, isDeleted: false }).select('+passwordReset');
  if (!user || user.status !== 'active') return;

  const prev = user.passwordReset;
  if (prev?.requestedAt && Date.now() - new Date(prev.requestedAt).getTime() < RESET_RESEND_COOLDOWN_MS) {
    return;
  }

  // 32 random bytes: nothing about it can be guessed or enumerated, so there
  // is no attempt counter to keep. Only its hash is stored.
  const token = crypto.randomBytes(32).toString('hex');
  user.passwordReset = {
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
    requestedAt: new Date(),
  };
  await user.save();
  await PasswordEmailService.sendResetLink(user, token, RESET_TTL_MINUTES);
};

/**
 * Set a new password from an emailed link.
 *
 * On success the link is spent, every session on every device is ended — if
 * someone else had got in, this is what throws them out — and the owner gets
 * an email saying the password changed.
 */
const resetPassword = async (emailRaw: unknown, token: unknown, newPassword: unknown): Promise<void> => {
  const password = assertNewPassword(newPassword);
  const email = String(emailRaw ?? '').trim().toLowerCase();
  const user: any = email
    ? await User.findOne({ email, isDeleted: false }).select('+passwordReset')
    : null;
  const rec = user?.passwordReset;
  const valid =
    !!user &&
    user.status === 'active' &&
    !!rec?.tokenHash &&
    !!rec?.expiresAt &&
    new Date(rec.expiresAt).getTime() > Date.now() &&
    sameHash(rec.tokenHash, sha256(String(token ?? '')));
  if (!valid) {
    const e: any = new Error(
      'এই লিংকটি আর কাজ করছে না — মেয়াদ শেষ বা আগেই ব্যবহার হয়েছে। নতুন লিংক চেয়ে নিন। (This link is invalid or has expired. Please ask for a new one.)'
    );
    e.status = 400;
    throw e;
  }

  user.password = password; // hashed by the model's pre-save hook
  user.isPasswordChanged = true;
  user.passwordChangedAt = new Date();
  user.set('passwordReset', undefined);
  await user.save();

  await SessionService.removeAllSessions(String(user._id));
  void PasswordEmailService.sendChanged(user, 'reset');
};

/**
 * An admin sets someone's password — the way back in for an account with no
 * email, or whose owner cannot reach it.
 *
 * Who may set whose follows the rules the Users screen's edit already had, so
 * this adds no power anyone did not hold: users.write at the route; a manager
 * only for student accounts; a superAdmin's password only by a superAdmin — an
 * admin able to take over the account above them is a promotion by another
 * name. The account is signed out everywhere, any pending reset link dies with
 * the old password, and the owner is emailed.
 *
 * isPasswordChanged goes back to false, because a password somebody else chose
 * is exactly what the dashboard's "change your password" prompt is for — unless
 * the admin is setting their own, which is simply a change.
 */
const adminSetPassword = async (
  actor: { _id: string; role: string },
  targetId: string,
  newPassword: unknown,
): Promise<{ email: string; name: string }> => {
  const password = assertNewPassword(newPassword);
  // The Users screen addresses people by their readable id ("STU-0042"), other
  // callers by _id; accept either, as the rest of the user routes do.
  const id = String(targetId || '');
  const byObjectId = /^[a-f0-9]{24}$/i.test(id);
  const user: any = await User.findOne(
    byObjectId ? { $or: [{ _id: id }, { id }] } : { id }
  ).select('+passwordReset');
  if (!user || user.isDeleted) {
    const e: any = new Error('User not found');
    e.status = 404;
    throw e;
  }
  if (user.role === 'superAdmin' && actor.role !== 'superAdmin') {
    const e: any = new Error("Only a super admin can change a super admin's password.");
    e.status = 403;
    throw e;
  }
  if ((MANAGER_ROLES as string[]).includes(actor.role) && !['student', 'user'].includes(user.role)) {
    const e: any = new Error('Managers can only change student passwords.');
    e.status = 403;
    throw e;
  }

  const self = String(user._id) === String(actor._id);
  user.password = password;
  user.isPasswordChanged = self;
  user.passwordChangedAt = new Date();
  user.set('passwordReset', undefined);
  await user.save();

  await SessionService.removeAllSessions(String(user._id));
  if (!self) void PasswordEmailService.sendChanged(user, 'admin');
  return {
    email: user.email || '',
    name: [user.firstName, user.lastName].filter(Boolean).join(' '),
  };
};

/** See RETIRED_DEFAULT_ADMIN at the top of this file. Safe to run on every boot. */
const retireDefaultAdminPassword = async (): Promise<boolean> => {
  const user: any = await User.findOne({ email: RETIRED_DEFAULT_ADMIN.email });
  if (!user?.password) return false;
  const stillDefault = await bcrypt.compare(RETIRED_DEFAULT_ADMIN.password, user.password);
  if (!stillDefault) return false;
  user.password = crypto.randomBytes(24).toString('base64');
  user.isPasswordChanged = false;
  user.passwordChangedAt = new Date();
  await user.save();
  await SessionService.removeAllSessions(String(user._id));
  return true;
};

export const AuthService = {
  loginUser,
  googleSignIn,
  refreshAccessToken,
  changePassword,
  requestPasswordReset,
  resetPassword,
  adminSetPassword,
  retireDefaultAdminPassword,
};

// Re-exported so the controller can tell a verification failure (which carries
// its own status + code) from anything else, without importing the verifier.
export { GoogleAuthError };
