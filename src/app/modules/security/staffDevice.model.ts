import { Schema, model } from 'mongoose';

/**
 * A staff account's device, and whether the Super Admin has let it in.
 *
 * Staff (admin, managers, mentors) sign in with a password as before, but a
 * device that is not `approved` here gets no session: the sign-in becomes a
 * request the Super Admin approves or rejects from the Security screen.
 * Removing a device deletes this record and its session, so the next sign-in
 * from it asks again. The Super Admin's own devices never need approval.
 */
const staffDeviceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

staffDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
staffDeviceSchema.index({ status: 1, requestedAt: -1 });

export const StaffDevice = model('StaffDevice', staffDeviceSchema);
