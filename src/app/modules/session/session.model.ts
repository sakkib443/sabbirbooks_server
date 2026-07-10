import { Schema, model } from 'mongoose';
import { ISession } from './session.interface';

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true },
    refreshTokenHash: { type: String, required: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    lastActiveAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
  }
);

// One session per (user, device): re-login from the same device replaces its
// session instead of counting as a new device.
sessionSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const Session = model<ISession>('Session', sessionSchema);
