/**
 * Who may sign in to the staff panels, from which device — decided by the
 * Super Admin.
 *
 *   • A staff account (admin, managers, mentors) signing in from a device the
 *     Super Admin has not approved gets no session. The attempt becomes a
 *     request, and every Super Admin is notified.
 *   • Every staff sign-in, approved or not, notifies the Super Admins.
 *   • The Super Admin sees every staff account's signed-in devices and can
 *     remove one or all — the session goes at once (authMiddleware checks it on
 *     every request) and the device has to be approved again.
 *   • The Super Admin's own sign-ins need no approval and raise no alert.
 */

import { Types } from 'mongoose';
import { Session } from '../session/session.model';
import { User } from '../user/user.model';
import { Notification } from '../notification/notification.model';
import { StaffDevice } from './staffDevice.model';

/** Roles whose new devices need the Super Admin's approval. */
export const APPROVAL_ROLES = ['admin', 'trainingManager', 'contentManager', 'manager', 'mentor'];

/** Roles whose sessions authMiddleware checks on every request. */
export const CHECKED_ROLES = ['superAdmin', ...APPROVAL_ROLES];

const ROLE_NAME: Record<string, string> = {
  admin: 'Admin',
  trainingManager: 'Training Manager',
  contentManager: 'Content Manager',
  manager: 'Manager',
  mentor: 'Mentor',
};

/** "Chrome on Windows" from a user-agent string — enough to recognise a device. */
export const deviceLabel = (ua?: string): string => {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'device';
  return `${browser} on ${os}`;
};

const nameOf = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || 'Someone';

/** In-panel notification (the bell) to every Super Admin. Never throws. */
const notifySuperAdmins = async (title: string, message: string) => {
  try {
    const supers = await User.find({ role: 'superAdmin', isDeleted: false }).select('_id').lean();
    if (!supers.length) return;
    await Notification.insertMany(
      supers.map((s: any) => ({ userId: s._id, type: 'system', title, message, link: '/dashboard/admin/security' }))
    );
  } catch (e) {
    console.error('[security] could not notify super admins:', e);
  }
};

export class DeviceApprovalError extends Error {
  status = 403;
  code = 'DEVICE_APPROVAL_REQUIRED';
}

/**
 * Called after the password (or Google) check succeeds, before a session is
 * made. Returns when the sign-in may go ahead; throws DeviceApprovalError when
 * the device is waiting for, or was refused, the Super Admin's approval.
 */
const gateStaffSignIn = async (
  user: { _id: unknown; role?: string; firstName?: string; lastName?: string; email?: string },
  device: { deviceId: string; userAgent?: string; ip?: string }
) => {
  const role = String(user.role || '');
  if (!APPROVAL_ROLES.includes(role)) return;

  const userId = new Types.ObjectId(String(user._id));
  const who = `${nameOf(user)} (${ROLE_NAME[role] || role})`;
  const where = `${deviceLabel(device.userAgent)}${device.ip ? ` · ${device.ip}` : ''}`;
  const existing: any = await StaffDevice.findOne({ userId, deviceId: device.deviceId }).lean();

  if (existing?.status === 'approved') {
    await StaffDevice.updateOne(
      { _id: existing._id },
      { $set: { lastLoginAt: new Date(), userAgent: device.userAgent || '', ip: device.ip || '' } }
    );
    void notifySuperAdmins('🔐 Staff login', `${who} signed in — ${where}`);
    return;
  }

  if (existing?.status === 'rejected') {
    void notifySuperAdmins('⛔ Refused device tried to sign in', `${who} — ${where}`);
    throw new DeviceApprovalError('এই ডিভাইস থেকে ঢোকার অনুমতি Super Admin বাতিল করেছেন।');
  }

  // New, or still waiting. Re-alert at most every ten minutes, so someone
  // pressing the button repeatedly does not flood the bell.
  const now = new Date();
  const stale = !existing || now.getTime() - new Date(existing.requestedAt).getTime() > 10 * 60_000;
  await StaffDevice.updateOne(
    { userId, deviceId: device.deviceId },
    {
      $set: { userAgent: device.userAgent || '', ip: device.ip || '', ...(stale ? { requestedAt: now } : {}) },
      $setOnInsert: { status: 'pending' },
    },
    { upsert: true }
  );
  if (stale) void notifySuperAdmins('📱 New device wants to sign in', `${who} — ${where}. Approve it from Security.`);
  throw new DeviceApprovalError(
    'নতুন ডিভাইস থেকে লগইনের অনুরোধ Super Admin-এর কাছে পাঠানো হয়েছে। অনুমোদন পেলে আবার লগইন করুন।'
  );
};

/** Pending requests and every staff account's devices, for the Security screen. */
const overview = async () => {
  const staff: any[] = await User.find({ role: { $in: CHECKED_ROLES }, isDeleted: false })
    .select('firstName lastName email role')
    .lean();
  const ids = staff.map((u) => u._id);
  const [sessions, devices] = await Promise.all([
    Session.find({ userId: { $in: ids } }).select('userId deviceId userAgent ip lastActiveAt createdAt').lean(),
    StaffDevice.find({ userId: { $in: ids } }).lean(),
  ]);
  const byUser = new Map(staff.map((u) => [String(u._id), u]));
  const users = staff
    .map((u) => {
      const uid = String(u._id);
      const own = devices.filter((d: any) => String(d.userId) === uid);
      return {
        _id: uid,
        name: nameOf(u),
        email: u.email,
        role: u.role,
        sessions: sessions
          .filter((s: any) => String(s.userId) === uid)
          .map((s: any) => ({
            deviceId: s.deviceId,
            device: deviceLabel(s.userAgent),
            ip: s.ip,
            lastActiveAt: s.lastActiveAt,
            signedInAt: s.createdAt,
            approval: own.find((d: any) => d.deviceId === s.deviceId)?.status || (u.role === 'superAdmin' ? 'owner' : 'approved'),
          }))
          .sort((a: any, b: any) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()),
      };
    })
    .sort((a, b) => b.sessions.length - a.sessions.length || a.name.localeCompare(b.name));
  const requests = devices
    .filter((d: any) => d.status !== 'approved')
    .map((d: any) => {
      const u = byUser.get(String(d.userId));
      return {
        _id: String(d._id),
        status: d.status,
        userId: String(d.userId),
        deviceId: d.deviceId,
        name: nameOf(u),
        email: u?.email,
        role: u?.role,
        device: deviceLabel(d.userAgent),
        ip: d.ip,
        requestedAt: d.requestedAt,
      };
    })
    .sort((a, b) => (a.status === b.status ? new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime() : a.status === 'pending' ? -1 : 1));
  return { requests, users };
};

const decide = async (id: string, status: 'approved' | 'rejected', by: string | null) => {
  if (!Types.ObjectId.isValid(id)) throw new Error('Request not found');
  const d: any = await StaffDevice.findByIdAndUpdate(
    id,
    { $set: { status, decidedAt: new Date(), decidedBy: by && Types.ObjectId.isValid(by) ? by : null } },
    { new: true }
  ).lean();
  if (!d) throw new Error('Request not found');
  // A device refused after it was let in is signed out at once.
  if (status === 'rejected') await Session.deleteOne({ userId: d.userId, deviceId: d.deviceId });
  return { status: d.status };
};

/** Sign a device out now; its next sign-in has to be approved again. */
const removeDevice = async (userId: string, deviceId: string) => {
  if (!Types.ObjectId.isValid(userId)) throw new Error('User not found');
  const uid = new Types.ObjectId(userId);
  const [s] = await Promise.all([
    Session.deleteOne({ userId: uid, deviceId }),
    StaffDevice.deleteOne({ userId: uid, deviceId }),
  ]);
  return { removed: s.deletedCount || 0 };
};

/** Sign every device of an account out now. */
const removeAll = async (userId: string) => {
  if (!Types.ObjectId.isValid(userId)) throw new Error('User not found');
  const uid = new Types.ObjectId(userId);
  const [s] = await Promise.all([Session.deleteMany({ userId: uid }), StaffDevice.deleteMany({ userId: uid })]);
  return { removed: s.deletedCount || 0 };
};

/**
 * At boot: every device a staff account is already signed in on counts as
 * approved, so switching this on signs nobody out. Insert-only — a decision
 * the Super Admin already made is never overwritten.
 */
const approveExistingSessions = async () => {
  const staff = await User.find({ role: { $in: APPROVAL_ROLES }, isDeleted: false }).select('_id').lean();
  if (!staff.length) return 0;
  const sessions: any[] = await Session.find({ userId: { $in: staff.map((u: any) => u._id) } })
    .select('userId deviceId userAgent ip')
    .lean();
  let added = 0;
  for (const s of sessions) {
    const r = await StaffDevice.updateOne(
      { userId: s.userId, deviceId: s.deviceId },
      { $setOnInsert: { status: 'approved', userAgent: s.userAgent || '', ip: s.ip || '', decidedAt: new Date() } },
      { upsert: true }
    );
    if (r.upsertedCount) added++;
  }
  return added;
};

export const SecurityService = {
  gateStaffSignIn,
  overview,
  decide,
  removeDevice,
  removeAll,
  approveExistingSessions,
  notifySuperAdmins,
};
