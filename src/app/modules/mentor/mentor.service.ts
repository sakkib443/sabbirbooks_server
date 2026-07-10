/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { TMentor } from './mentor.interface';
import { Mentor } from './mentor.model';
import { User } from '../user/user.model';

const DEFAULT_MENTOR_PASSWORD = 'Mentor@123456';

// Ensure a User account (role 'mentor') exists for this mentor, and return it +
// the plaintext password used (so the caller can show credentials once).
const ensureMentorUser = async (payload: any): Promise<{ user: any; plainPassword: string | null; created: boolean }> => {
  const name = (payload.name || 'Mentor').trim();
  const nameParts = name.split(' ');
  const email = payload.email || `${name.toLowerCase().replace(/\s+/g, '')}@gmail.com`;

  const existing = await User.findOne({ email });
  if (existing) {
    // Link/upgrade to mentor — but never downgrade an admin/superAdmin account.
    if (!['mentor', 'admin', 'superAdmin'].includes(existing.role as string)) {
      existing.role = 'mentor' as any;
      await existing.save();
    }
    return { user: existing, plainPassword: null, created: false };
  }

  const plainPassword = payload.password?.trim() || DEFAULT_MENTOR_PASSWORD;
  const userCount = await User.countDocuments();
  const user = await User.create({
    id: `bac-mentor-${String(userCount + 1).padStart(3, '0')}`,
    email,
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' ') || '',
    phoneNumber: payload.phone || '',
    password: plainPassword, // hashed by the User pre-save hook
    role: 'mentor',
    status: 'active',
    isDeleted: false,
    isPasswordChanged: false,
    image: payload.image || '',
  });
  return { user, plainPassword, created: true };
};

// CREATE — also auto-provisions a mentor-role User and returns login credentials
const createMentorServices = async (payload: TMentor & { password?: string }) => {
  const id = (payload.id || '').trim();
  if (id) {
    const clash = await Mentor.findOne({ id });
    if (clash) {
      throw new Error(`Mentor ID "${id}" already exists. Please choose a different ID.`);
    }
  }

  const { user, plainPassword, created } = await ensureMentorUser(payload);

  const mentorData: any = { ...payload, email: user.email, userId: user._id };
  delete mentorData.password; // never store the password on the mentor doc
  if (mentorData.isPublished === undefined) mentorData.isPublished = true;

  const mentor = await Mentor.create(mentorData);

  return {
    mentor,
    credentials: {
      email: user.email,
      // Only reveal a password when we actually created a new account with one
      password: created ? plainPassword : null,
      role: 'mentor',
      userCreated: created,
    },
  };
};

// READ ALL — publicOnly filters to website-visible mentors
const getAllMentorsServices = async (publicOnly = false) => {
  const filter = publicOnly
    ? { $or: [{ isPublished: true }, { isPublished: { $exists: false } }] }
    : {};
  return await Mentor.find(filter).populate('userId', 'email role status').sort({ _id: 1 });
};

// READ SINGLE
const getSingleMentorServices = async (id: string): Promise<TMentor | null> => {
  if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
    const result = await Mentor.findById(id).populate('userId', 'email role status');
    if (result) return result as unknown as TMentor;
  }
  return (await Mentor.findOne({ id }).populate(
    'userId',
    'email role status'
  )) as unknown as TMentor | null;
};

// UPDATE — backfills a mentor-role user for older mentors that never had one
const updateMentorServices = async (
  id: string,
  payload: Partial<TMentor> & { password?: string }
): Promise<TMentor | null> => {
  const query = mongoose.Types.ObjectId.isValid(id) && id.length === 24 ? { _id: id } : { id };
  const current = await Mentor.findOne(query);
  if (!current) return null;

  // If this mentor has no linked login user yet, create/link one now.
  if (!current.get('userId') && (payload.email || current.get('email'))) {
    const { user } = await ensureMentorUser({
      name: payload.name || current.get('name'),
      email: payload.email || current.get('email'),
      phone: payload.phone || current.get('phone'),
      image: payload.image || current.get('image'),
      password: (payload as any).password,
    });
    (payload as any).userId = user._id;
  }
  delete (payload as any).password;

  const updated = await Mentor.findOneAndUpdate(query, payload, { new: true })
    .populate('userId', 'email role status');
  return updated as unknown as TMentor | null;
};

// DELETE — also deactivates the linked User account
const deleteMentorServices = async (id: string): Promise<TMentor | null> => {
  let mentor: any = null;
  if (mongoose.Types.ObjectId.isValid(id) && id.length === 24) {
    mentor = await Mentor.findByIdAndDelete(id);
  }
  if (!mentor) {
    mentor = await Mentor.findOneAndDelete({ id });
  }
  if (mentor?.userId) {
    await User.findByIdAndUpdate(mentor.userId, { status: 'blocked', isDeleted: true });
  }
  return mentor;
};

export const MentorService = {
  createMentorServices,
  getAllMentorsServices,
  getSingleMentorServices,
  updateMentorServices,
  deleteMentorServices,
};
