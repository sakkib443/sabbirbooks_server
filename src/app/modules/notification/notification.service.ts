import { Notification } from './notification.model';
import { User } from '../user/user.model';

// ═══ CORE CRUD ══════════════════════════════════════════════

const create = async (userId: string, type: string, title: string, message: string, link?: string) => {
  return Notification.create({ userId, type, title, message, link });
};

const createBulk = async (userIds: string[], type: string, title: string, message: string, link?: string) => {
  const docs = userIds.map(userId => ({ userId, type, title, message, link }));
  return Notification.insertMany(docs);
};

const getUserNotifications = async (userId: string, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const [notifications, total, unread] = await Promise.all([
    Notification.find({ userId, isDeleted: false }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments({ userId, isDeleted: false }),
    Notification.countDocuments({ userId, isRead: false, isDeleted: false }),
  ]);
  return { notifications, total, unread, page, limit };
};

const getUnreadCount = async (userId: string) => {
  return Notification.countDocuments({ userId, isRead: false, isDeleted: false });
};

const markAsRead = async (notificationId: string, userId: string) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true },
    { new: true }
  );
};

const markAllAsRead = async (userId: string) => {
  return Notification.updateMany(
    { userId, isRead: false, isDeleted: false },
    { isRead: true }
  );
};

const remove = async (notificationId: string, userId: string) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isDeleted: true }
  );
};

const clearAll = async (userId: string) => {
  return Notification.updateMany(
    { userId, isDeleted: false },
    { isDeleted: true }
  );
};

// ═══ HELPER: Get all admin user IDs ════════════════════════
const getAdminUserIds = async (): Promise<string[]> => {
  const admins = await User.find({
    role: { $in: ['superAdmin', 'admin', 'trainingManager'] },
    isDeleted: false,
  }).select('_id');
  console.log(`🔍 Found ${admins.length} admin(s) for notification`);
  return admins.map(a => a._id.toString());
};

// ═══ TRIGGER HELPERS ════════════════════════════════════════
// These are called from other services when events happen

const triggerPaymentVerified = async (userId: string, courseName: string) => {
  return create(userId, 'payment', '💳 Payment Verified',
    `Your payment for "${courseName}" has been verified. Welcome aboard!`,
    '/dashboard/user/courses');
};

const triggerEnrollmentActive = async (userId: string, courseName: string) => {
  return create(userId, 'enrollment', '🎉 Enrollment Confirmed',
    `You are now enrolled in "${courseName}". Start learning today!`,
    '/dashboard/user/courses');
};

const triggerClassReminder = async (userId: string, className: string, time: string) => {
  return create(userId, 'reminder', '📅 Class Reminder',
    `Your class "${className}" starts at ${time}. Get ready!`,
    '/dashboard/user/schedule');
};

const triggerRecordingAvailable = async (userId: string, className: string) => {
  return create(userId, 'class', '🎥 Recording Available',
    `Recording for "${className}" is now available.`,
    '/dashboard/user/schedule');
};

const triggerExamPublished = async (userId: string, examTitle: string) => {
  return create(userId, 'exam', '📝 New Exam Available',
    `Exam "${examTitle}" is now available. Good luck!`,
    '/dashboard/user/exams');
};

const triggerExamGraded = async (userId: string, examTitle: string, marks: number, total: number) => {
  return create(userId, 'exam', '📊 Exam Graded',
    `Your exam "${examTitle}" has been graded: ${marks}/${total}`,
    '/dashboard/user/marks');
};

const triggerAssignmentDue = async (userId: string, title: string, deadline: string) => {
  return create(userId, 'assignment', '⏰ Assignment Due',
    `Assignment "${title}" is due on ${deadline}. Don't forget to submit!`,
    '/dashboard/user/assignments');
};

const triggerAssignmentGraded = async (userId: string, title: string, marks: number, total: number) => {
  return create(userId, 'assignment', '✅ Assignment Graded',
    `Your assignment "${title}" has been graded: ${marks}/${total}`,
    '/dashboard/user/assignments');
};

const triggerCertificateReady = async (userId: string, courseName: string) => {
  return create(userId, 'certificate', '🎓 Certificate Ready',
    `Your certificate for "${courseName}" is ready!`,
    '/dashboard/user/certificates');
};

const triggerInstallmentDue = async (userId: string, courseName: string, amount: number, dueDate: string) => {
  return create(userId, 'payment', '💰 Installment Due',
    `Installment of ৳${amount} for "${courseName}" is due on ${dueDate}.`,
    '/dashboard/user/payments');
};

const triggerSystemAnnouncement = async (userIds: string[], title: string, message: string) => {
  return createBulk(userIds, 'system', `📢 ${title}`, message);
};

// ═══ ADMIN TRIGGERS ═══════════════════════════════════════════
// Notify all admins when important events happen

const triggerNewOrderForAdmins = async (
  studentName: string,
  courseName: string,
  amount: number,
  paymentMethod: string,
) => {
  try {
    const adminIds = await getAdminUserIds();
    if (adminIds.length === 0) return;
    await createBulk(
      adminIds,
      'enrollment',
      '🛒 নতুন অর্ডার এসেছে!',
      `${studentName} "${courseName}" কোর্সে ৳${amount.toLocaleString()} (${paymentMethod}) দিয়ে অর্ডার করেছে।`,
      '/dashboard/admin/orders'
    );
  } catch (e) {
    console.error('Admin order notification failed:', e);
  }
};

const triggerNewRegistrationForAdmins = async (
  studentName: string,
  email: string,
  authProvider: string,
) => {
  try {
    const adminIds = await getAdminUserIds();
    if (adminIds.length === 0) return;
    await createBulk(
      adminIds,
      'system',
      '👤 নতুন রেজিস্ট্রেশন!',
      `${studentName} (${email}) ${authProvider === 'google' ? 'Google দিয়ে' : 'ইমেইল দিয়ে'} রেজিস্টার করেছে।`,
      '/dashboard/admin/user'
    );
  } catch (e) {
    console.error('Admin registration notification failed:', e);
  }
};

export const NotificationService = {
  create, createBulk,
  getUserNotifications, getUnreadCount,
  markAsRead, markAllAsRead, remove, clearAll,
  // Triggers
  triggerPaymentVerified, triggerEnrollmentActive,
  triggerClassReminder, triggerRecordingAvailable,
  triggerExamPublished, triggerExamGraded,
  triggerAssignmentDue, triggerAssignmentGraded,
  triggerCertificateReady, triggerInstallmentDue,
  triggerSystemAnnouncement,
  // Admin triggers
  triggerNewOrderForAdmins,
  triggerNewRegistrationForAdmins,
};
