/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/modules/auth/auth.service.ts
import { User } from '../user/user.model';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { SessionService } from '../session/session.service';

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
    const { deviceId } = await SessionService.createSession({
      userId: String(adminUser._id),
      deviceId: device.deviceId,
      refreshToken,
      userAgent: device.userAgent,
      ip: device.ip,
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
      role: user.role,
      status: user.status,
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
  await User.findByIdAndUpdate(userId, { password: hashedPassword });
};

export const AuthService = {
  loginUser,
  refreshAccessToken,
  changePassword,
};
