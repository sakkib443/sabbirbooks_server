import { User } from './user.model';
import { IUser } from './user.interface';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

/**
 * Generate a user id in format: bac-(YYYY)-NN
 * Example: bac-(2025)-01, bac-(2025)-02, etc.
 */
async function generateUserId(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `bac-(${year})-`;

  // Count total users to get the next sequence number
  // This ensures unique IDs even if previous IDs were malformed
  const totalUsers = await User.countDocuments({});

  // Also check for the highest sequence number in existing IDs with proper format
  const usersWithProperFormat = await User.find({
    id: { $regex: `^bac-\\(\\d{4}\\)-\\d+$` }
  }).select('id').lean();

  let maxSeq = totalUsers; // Start with total count as minimum

  for (const user of usersWithProperFormat) {
    if (user.id) {
      const match = user.id.match(/-(\d+)$/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (!Number.isNaN(seq) && seq >= maxSeq) {
          maxSeq = seq;
        }
      }
    }
  }

  const nextSeq = maxSeq + 1;
  const seqStr = String(nextSeq).padStart(2, '0');
  return `${prefix}${seqStr}`;
}

interface CreateUserResponse {
  user: IUser;
  token: string;
}

const createUserServices = async (payload: IUser): Promise<CreateUserResponse> => {
  // Do not accept externally provided id — generate it here.
  // Public signup is ALWAYS a student — never trust a client-supplied role (privilege-escalation guard).
  const id = await generateUserId();
  const toCreate = { ...payload, id, role: 'student', authProvider: 'local' as const } as IUser;

  const newUser = await User.create(toCreate);

  const token = jwt.sign(
    { _id: newUser._id, role: newUser.role, email: newUser.email },
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'default_secret',
    { expiresIn: '7d' }
  );

  return { user: newUser, token };
};

// ── Create a STAFF account (admin / trainingManager) from the dashboard ──
// requesterRole enforces: only a superAdmin may create an 'admin'.
const createStaffServices = async (
  payload: { firstName: string; lastName?: string; email: string; phoneNumber?: string; password: string; role: 'admin' | 'trainingManager' },
  requesterRole: string,
): Promise<{ user: IUser; credentials: { email: string; password: string; role: string } }> => {
  if (!['admin', 'trainingManager'].includes(payload.role)) {
    throw new Error('Staff role must be admin or trainingManager');
  }
  if (payload.role === 'admin' && requesterRole !== 'superAdmin') {
    const e: any = new Error('Only a Super Admin can create admin accounts');
    e.statusCode = 403;
    throw e;
  }

  const email = String(payload.email || '').toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) {
    const e: any = new Error('This email is already registered');
    e.statusCode = 409;
    throw e;
  }

  const id = await generateUserId();
  const user = await User.create({
    id,
    email,
    firstName: payload.firstName,
    lastName: payload.lastName || '',
    phoneNumber: payload.phoneNumber || '',
    password: payload.password, // hashed by the User pre-save hook
    role: payload.role,
    status: 'active',
    isDeleted: false,
    isPasswordChanged: false,
    authProvider: 'local',
  } as any);

  return { user, credentials: { email, password: payload.password, role: payload.role } };
};

// ── Create a STUDENT account from the dashboard (admin / superAdmin / trainingManager) ──
// Role is always forced to 'student'. Returns credentials to show once.
const createStudentServices = async (
  payload: { firstName: string; lastName?: string; email: string; phoneNumber?: string; password: string },
): Promise<{ user: IUser; credentials: { email: string; password: string; role: string } }> => {
  const email = String(payload.email || '').toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) {
    const e: any = new Error('This email is already registered');
    e.statusCode = 409;
    throw e;
  }

  const id = await generateUserId();
  const user = await User.create({
    id,
    email,
    firstName: payload.firstName,
    lastName: payload.lastName || '',
    phoneNumber: payload.phoneNumber || '',
    password: payload.password, // hashed by the User pre-save hook
    role: 'student',
    status: 'active',
    isDeleted: false,
    isPasswordChanged: false,
    authProvider: 'local',
  } as any);

  return { user, credentials: { email, password: payload.password, role: 'student' } };
};

// Google Login/Register
const googleLoginServices = async (payload: {
  firstName: string;
  lastName?: string;
  email: string;
  image?: string;
  googleId: string;
}): Promise<CreateUserResponse> => {
  // Check if user already exists
  let user = await User.findOne({ email: payload.email, isDeleted: false });

  if (user) {
    // Update google info if needed
    if (!user.googleId) {
      user.googleId = payload.googleId;
      user.authProvider = 'google';
      if (payload.image) user.image = payload.image;
      await user.save();
    }
  } else {
    // Create new user
    const id = await generateUserId();
    user = await User.create({
      id,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName || '',
      phoneNumber: '',
      password: '',
      role: 'student',
      status: 'active',
      image: payload.image || '',
      googleId: payload.googleId,
      authProvider: 'google',
    });
  }

  const token = jwt.sign(
    { _id: user._id, role: user.role, email: user.email },
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'default_secret',
    { expiresIn: '7d' }
  );

  return { user, token };
};

const getAllUsersServices = async (): Promise<IUser[]> => {
  // Exclude password hash from the admin list response
  const users = await User.find({ isDeleted: false }).select('-password');
  return users;
};

const getSingleUserServices = async (id: string): Promise<IUser | null> => {
  // Try to find by MongoDB _id first, then by custom id field
  const isValidObjectId = /^[a-f\d]{24}$/i.test(id);

  const query = isValidObjectId
    ? { $or: [{ _id: id }, { id: id }], isDeleted: false }
    : { id: id, isDeleted: false };

  const user = await User.findOne(query).select('-password');
  return user;
};

const updateUserServices = async (id: string, payload: Partial<IUser>): Promise<IUser | null> => {
  // Try to find by MongoDB _id first, then by custom id field
  const isValidObjectId = /^[a-f\d]{24}$/i.test(id);

  const query = isValidObjectId
    ? { $or: [{ _id: id }, { id: id }], isDeleted: false }
    : { id: id, isDeleted: false };

  // findOneAndUpdate bypasses the model's pre-save hook, so a raw password
  // would be stored in plaintext → login would break. Hash it here.
  const data: Partial<IUser> = { ...payload };
  if (data.password) {
    data.password = await bcrypt.hash(data.password, 10);
  }

  const updatedUser = await User.findOneAndUpdate(
    query,
    data,
    { new: true }
  ).select('-password');
  return updatedUser;
};

const deleteUserServices = async (id: string): Promise<IUser | null> => {
  // Try to find by MongoDB _id first, then by custom id field
  const isValidObjectId = /^[a-f\d]{24}$/i.test(id);

  const query = isValidObjectId
    ? { $or: [{ _id: id }, { id: id }], isDeleted: false }
    : { id: id, isDeleted: false };

  const deletedUser = await User.findOneAndUpdate(
    query,
    { isDeleted: true },
    { new: true }
  );
  return deletedUser;
};

export const UserService = {
  createUserServices,
  createStaffServices,
  createStudentServices,
  googleLoginServices,
  getAllUsersServices,
  getSingleUserServices,
  updateUserServices,
  deleteUserServices,
};
