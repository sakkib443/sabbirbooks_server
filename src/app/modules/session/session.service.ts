/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { Types } from 'mongoose';
import { Session } from './session.model';
import config from '../../config';

// Max concurrent devices per user (default 2). Oldest is auto-evicted.
const MAX_DEVICES = Number(config.device_limit) || 2;

// Never store the raw refresh token — store a sha256 hash we can look up by.
const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

// Use the client-supplied x-device-id, or mint a stable UUID if absent.
const resolveDeviceId = (deviceId?: string): string => {
  const trimmed = (deviceId || '').trim();
  return trimmed || crypto.randomUUID();
};

interface CreateSessionInput {
  userId: string | Types.ObjectId;
  deviceId?: string;
  refreshToken: string;
  userAgent?: string;
  ip?: string;
}

/**
 * Create (or refresh) a device session, enforcing the per-user device limit.
 * - Same (userId, deviceId) → the existing session is updated (no eviction).
 * - New device while at the limit → the OLDEST session (by lastActiveAt, then
 *   createdAt, then _id) is deleted → that device is auto-logged-out.
 * Returns the resolved deviceId so the client can persist it.
 */
const createSession = async (input: CreateSessionInput): Promise<{ deviceId: string }> => {
  const userId = new Types.ObjectId(String(input.userId));
  const deviceId = resolveDeviceId(input.deviceId);
  const refreshTokenHash = hashToken(input.refreshToken);
  const now = new Date();

  // Same device re-login → replace its session (no eviction).
  const existing = await Session.findOne({ userId, deviceId });
  if (existing) {
    existing.refreshTokenHash = refreshTokenHash;
    existing.userAgent = input.userAgent || '';
    existing.ip = input.ip || '';
    existing.lastActiveAt = now;
    await existing.save();
    return { deviceId };
  }

  // New device → enforce the limit BEFORE inserting the new session.
  const activeCount = await Session.countDocuments({ userId });
  if (activeCount >= MAX_DEVICES) {
    const evictCount = activeCount - MAX_DEVICES + 1;
    const oldest = await Session.find({ userId })
      .sort({ lastActiveAt: 1, createdAt: 1, _id: 1 })
      .limit(evictCount)
      .select('_id');
    if (oldest.length) {
      await Session.deleteMany({ _id: { $in: oldest.map((s) => s._id) } });
    }
  }

  await Session.create({
    userId,
    deviceId,
    refreshTokenHash,
    userAgent: input.userAgent || '',
    ip: input.ip || '',
    lastActiveAt: now,
  });

  return { deviceId };
};

/**
 * Validate that a live session exists for this refresh token on this device.
 * Returns true (and bumps lastActiveAt) if valid; false if the session was
 * evicted / never existed → caller should respond 401 (device logged out).
 */
const validateAndTouchSession = async (
  userId: string | Types.ObjectId,
  deviceId: string,
  refreshToken: string,
): Promise<boolean> => {
  const uid = new Types.ObjectId(String(userId));
  const refreshTokenHash = hashToken(refreshToken);
  const session = await Session.findOne({ userId: uid, deviceId, refreshTokenHash });
  if (!session) return false;
  session.lastActiveAt = new Date();
  await session.save();
  return true;
};

// List a user's active sessions (never expose the token hash).
const listSessions = async (userId: string | Types.ObjectId): Promise<any[]> => {
  const uid = new Types.ObjectId(String(userId));
  return Session.find({ userId: uid })
    .select('-refreshTokenHash')
    .sort({ lastActiveAt: -1 })
    .lean();
};

// Remove the session for one device (logout on this device).
const removeSession = async (
  userId: string | Types.ObjectId,
  deviceId: string,
): Promise<boolean> => {
  const uid = new Types.ObjectId(String(userId));
  const result = await Session.deleteOne({ userId: uid, deviceId });
  return (result.deletedCount || 0) > 0;
};

// Remove all of a user's sessions (logout everywhere).
const removeAllSessions = async (userId: string | Types.ObjectId): Promise<number> => {
  const uid = new Types.ObjectId(String(userId));
  const result = await Session.deleteMany({ userId: uid });
  return result.deletedCount || 0;
};

export const SessionService = {
  MAX_DEVICES,
  hashToken,
  resolveDeviceId,
  createSession,
  validateAndTouchSession,
  listSessions,
  removeSession,
  removeAllSessions,
};
