import { Schema, model } from 'mongoose';
import { IUser } from './user.interface';
import bcrypt from 'bcryptjs';

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
      enum: ['superAdmin', 'admin', 'trainingManager', 'mentor', 'student'],
      required: true,
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
