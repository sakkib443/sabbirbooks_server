import { Types } from 'mongoose';

/**
 * A Session represents one logged-in DEVICE for a user.
 * The device-limit feature keeps at most `config.device_limit` sessions per
 * user and auto-evicts the oldest (by lastActiveAt) when a new device logs in.
 */
export interface ISession {
  _id?: string;
  userId: Types.ObjectId;
  deviceId: string;
  refreshTokenHash: string; // sha256 hash of the issued refresh token (never store the raw token)
  userAgent?: string;
  ip?: string;
  lastActiveAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}
