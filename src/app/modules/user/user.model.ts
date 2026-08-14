import { Schema, model } from 'mongoose';
import { IUser } from './user.interface';
import bcrypt from 'bcryptjs';
import { CAPABILITY_KEYS, ROLES } from '../../config/permissions';

const userSchema = new Schema<IUser>(
  {
    id: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    location: { type: String, default: '' },
    gender: { type: String, enum: ['male', 'female', 'other'], required: false },
    password: { type: String, required: false, default: '' },
    isPasswordChanged: { type: Boolean, default: false },
    role: {
      type: String,
      enum: [...ROLES],
      required: true,
    },
    // Per-user capability overrides — see app/config/permissions.ts.
    //
    // `default: undefined` is load-bearing: it keeps the field ABSENT on every
    // existing document, and resolveCapabilities() reads "absent" as "use the
    // role's defaults". A default of [] would instead read as "no permissions
    // at all" and lock out all 7 live accounts on the next deploy.
    permissions: {
      type: [String],
      enum: [...CAPABILITY_KEYS],
      default: undefined,
    },
    status: {
      type: String,
      enum: ['active', 'blocked', 'pending'],
      default: 'active',
    },
    isDeleted: { type: Boolean, default: false },
    image: { type: String, default: '' },
    googleId: { type: String, default: '' },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function (next) {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

export const User = model<IUser>('User', userSchema);
