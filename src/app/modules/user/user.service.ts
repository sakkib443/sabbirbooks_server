import { User } from './user.model';
import { IUser } from './user.interface';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  Capability,
  isManagerRole,
  resolveCapabilities,
  sanitizePermissions,
} from '../../config/permissions';

/**
 * Generate a user id in format: bac-(YYYY)-NN
 * Example: bac-(2025)-01, bac-(2025)-02, etc.
 *
 * Exported so Google sign-in (auth.service.ts) mints ids from the same
 * sequence as every other account, rather than inventing a second scheme.
 */
export async function generateUserId(): Promise<string> {
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

// ── Create a STAFF account (admin / trainingManager / contentManager) ──
// requesterRole enforces: only a superAdmin may create an 'admin'.
const createStaffServices = async (
  payload: {
    firstName: string;
    lastName?: string;
    email: string;
    phoneNumber?: string;
    password: string;
    role: 'admin' | 'trainingManager' | 'contentManager';
    permissions?: unknown;
  },
  requesterRole: string,
): Promise<{ user: IUser; credentials: { email: string; password: string; role: string } }> => {
  if (!['admin', 'trainingManager', 'contentManager'].includes(payload.role)) {
    throw new Error('Staff role must be admin, trainingManager or contentManager');
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

  // Only a manager gets a stored permission list, and only when one was sent.
  // Leaving it undefined means "use the role defaults" — see permissions.ts.
  const permissions =
    isManagerRole(payload.role) && payload.permissions !== undefined
      ? sanitizePermissions(payload.permissions)
      : undefined;

  const id = await generateUserId();
  const user = await User.create({
    id,
    email,
    firstName: payload.firstName,
    lastName: payload.lastName || '',
    phoneNumber: payload.phoneNumber || '',
    password: payload.password, // hashed by the User pre-save hook
    role: payload.role,
    ...(permissions ? { permissions } : {}),
    status: 'active',
    isDeleted: false,
    isPasswordChanged: false,
    authProvider: 'local',
  } as any);

  return { user, credentials: { email, password: payload.password, role: payload.role } };
};

// ── Replace a manager's capability list ──
// The ONLY writer of the `permissions` field. Guarded by staff.manage at the
// route, and by the caller checks in updateUserPermissionsController.
const setUserPermissionsServices = async (
  id: string,
  permissions: unknown,
): Promise<IUser | null> => {
  const isValidObjectId = /^[a-f\d]{24}$/i.test(id);
  const query = isValidObjectId
    ? { $or: [{ _id: id }, { id: id }], isDeleted: false }
    : { id: id, isDeleted: false };

  const clean: Capability[] = sanitizePermissions(permissions);

  const updated = await User.findOneAndUpdate(
    query,
    { permissions: clean },
    { new: true },
  ).select('-password');
  return updated;
};

/** The capabilities a stored user actually resolves to — for /auth/me and the UI. */
const capabilitiesFor = (user: { role?: unknown; permissions?: unknown } | null): Capability[] =>
  resolveCapabilities(user?.role, user?.permissions);

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

// REMOVED 2026-08-14 — googleLoginServices().
//
// It trusted a { firstName, email, googleId } request body, found the account
// by that email and signed a JWT carrying its real role, with 'default_secret'
// as the fallback signing key and a hardcoded 7d expiry. Naming an address was
// all it took to be handed that account, superAdmin included.
//
// Deleting rather than commenting out is the point: an exported helper that
// still works is one route line away from being live again. The replacement is
// AuthService.googleSignIn() in modules/auth/, which verifies a Google-signed
// ID token before it will look up anything.

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

  // `permissions` is NEVER writable through the generic user PATCH. That route
  // is open to trainingManager (for student accounts), so honouring the field
  // here would be a self-service escalation path. It has exactly one writer:
  // PATCH /api/user/:id/permissions, behind the staff.manage capability.
  delete (data as { permissions?: unknown }).permissions;

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
  getAllUsersServices,
  getSingleUserServices,
  updateUserServices,
  setUserPermissionsServices,
  capabilitiesFor,
  deleteUserServices,
};
