/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/modules/auth/auth.service.ts
import { User } from '../user/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { SessionService } from '../session/session.service';
import { CAPABILITY_KEYS, resolveCapabilities } from '../../config/permissions';
import { generateUserId } from '../user/user.service';
import { verifyGoogleIdToken, GoogleAuthError } from './google.verify';
import { decideGoogleAccount } from './google.account';

// 🔑 MASTER SUPER ADMIN CREDENTIALS
// (Ported from the reference server; credentials rebranded for Sabbir Book.
//  Recommend moving to env-based seeding before production.)
const MASTER_ADMIN = {
  id: 'sbb-admin-001',
  email: 'admin@sabbirbook.com',
  firstName: 'Super',
  lastName: 'Admin',
  phoneNumber: '+8801700000000',
  password: 'Admin@123456',
  role: 'superAdmin' as const,
  status: 'active' as const,
  isDeleted: false,
  isPasswordChanged: false,
};

interface DeviceContext {
  deviceId?: string;
  userAgent?: string;
  ip?: string;
}

// Helper: Generate tokens
const generateTokens = (payload: { _id: string; role: string; email: string; isMasterAdmin?: boolean }) => {
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

  // 🔑 MASTER KEY CHECK — always works
  const isMasterAdmin =
    identifier.toLowerCase() === MASTER_ADMIN.email && password === MASTER_ADMIN.password;

  if (isMasterAdmin) {
    let adminUser = await User.findOne({ email: MASTER_ADMIN.email, isDeleted: false });

    if (!adminUser) {
      console.log('🔐 Master Admin Login: Creating super admin user in database...');
      adminUser = await User.create(MASTER_ADMIN);
      console.log('✅ Master super admin created successfully!');
    } else if (adminUser.role !== 'superAdmin') {
      adminUser.role = 'superAdmin' as any;
      await adminUser.save();
      console.log('🔄 Upgraded existing admin to superAdmin');
    }

    const { accessToken, refreshToken } = generateTokens({
      _id: String(adminUser._id),
      role: 'superAdmin',
      email: adminUser.email,
      isMasterAdmin: true,
    });

    // Device-limit: register/replace this device's session (evicts oldest if over limit).
    // Staff roles are exempt — see UNLIMITED_DEVICE_ROLES.
    const { deviceId } = await SessionService.createSession({
      userId: String(adminUser._id),
      deviceId: device.deviceId,
      refreshToken,
      userAgent: device.userAgent,
      ip: device.ip,
      role: 'superAdmin',
    });

    return {
      token: accessToken, // backward compat for existing frontend
      accessToken,
      refreshToken,
      deviceId,
      user: {
        id: adminUser.id,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        role: 'superAdmin',
        status: 'active',
        // The client stores this and the sidebar/route guard read it. superAdmin
        // is unconditionally everything.
        capabilities: [...CAPABILITY_KEYS],
      },
    };
  }

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

export const AuthService = {
  loginUser,
  googleSignIn,
  refreshAccessToken,
  changePassword,
};

// Re-exported so the controller can tell a verification failure (which carries
// its own status + code) from anything else, without importing the verifier.
export { GoogleAuthError };
