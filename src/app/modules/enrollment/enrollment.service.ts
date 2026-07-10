import { Enrollment } from './enrollment.model';
import { Course } from '../courses/course.model';
import { User } from '../user/user.model';
// PORT: notification module dropped — NotificationService (admin new-order alerts) disabled.
// import { NotificationService } from '../notification/notification.service';
// PORT: notification module dropped — EmailService (money-receipt emails) disabled.
// import { EmailService } from '../notification/email.service';

// ─── Create Enrollment (after payment) ──────────────────────
const createEnrollment = async (payload: {
  studentId: string;
  courseId: string;
  batchId?: string;
  // এই enrollment-এর জন্য চূড়ান্ত মোট ফি (discount/partial checkout থেকে) — না দিলে course.fee ধরা হয়
  customFee?: number;
  // Course coupon applied at first checkout (customFee already reflects the discount)
  couponCode?: string;
  couponDiscount?: number;
  payment: {
    amount: number;
    method: 'bkash' | 'sslcommerz' | 'manual' | 'free';
    transactionId?: string;
  };
}) => {
  // Check if already enrolled (include soft-deleted so we revive it, not create a duplicate)
  const existing = await Enrollment.findOne({
    studentId: payload.studentId,
    courseId: payload.courseId,
  });

  if (existing && existing.status === 'active' && !existing.isDeleted) {
    throw new Error('Already enrolled in this course');
  }

  // ── Helper: Send admin notification ──────────────────────
  const notifyAdmins = async () => {
    try {
      const [student, course] = await Promise.all([
        User.findById(payload.studentId).select('firstName lastName name').lean(),
        Course.findById(payload.courseId).select('title').lean(),
      ]);
      const studentName = student
        ? `${(student as any).firstName || (student as any).name || 'Student'} ${(student as any).lastName || ''}`.trim()
        : 'Unknown Student';
      const courseName = (course as any)?.title || 'Unknown Course';
      console.log(`📢 Sending admin notification: ${studentName} ordered ${courseName}`);
      // PORT: notification module dropped — admin new-order alert disabled.
      // await NotificationService.triggerNewOrderForAdmins(
      //   studentName,
      //   courseName,
      //   payload.payment.amount,
      //   payload.payment.method,
      // );
      console.log('✅ Admin notification sent successfully');
    } catch (notifErr) {
      console.error('❌ Admin notification (new order) failed:', notifErr);
    }
  };

  // If there's an existing cancelled/expired enrollment, update it
  if (existing) {
    existing.status = 'pending';
    existing.isDeleted = false;   // revive if it was soft-deleted
    existing.payment = {
      ...payload.payment,
      status: payload.payment.method === 'free' ? 'paid' : 'pending',
      paidAt: payload.payment.method === 'free' ? new Date() : undefined,
    } as any;
    if (payload.customFee !== undefined) {
      (existing as any).customFee = payload.customFee;
    }
    if (payload.couponCode) {
      (existing as any).couponCode = payload.couponCode;
      (existing as any).couponDiscount = payload.couponDiscount;
    }
    await existing.save();
    // Notify admins about re-enrollment too
    await notifyAdmins();
    return existing;
  }

  const enrollment = await Enrollment.create({
    studentId: payload.studentId,
    courseId: payload.courseId,
    batchId: payload.batchId,
    customFee: payload.customFee,
    couponCode: payload.couponCode,
    couponDiscount: payload.couponDiscount,
    status: payload.payment.method === 'free' ? 'active' : 'pending',
    payment: {
      amount: payload.payment.amount,
      method: payload.payment.method,
      transactionId: payload.payment.transactionId,
      status: payload.payment.method === 'free' ? 'paid' : 'pending',
      paidAt: payload.payment.method === 'free' ? new Date() : undefined,
    },
  });

  // Count coupon usage once — only on a brand-new enrollment (revive doesn't re-count).
  if (payload.couponCode) {
    try {
      const { CourseCoupon } = await import('../coupon/coupon.model');
      await CourseCoupon.updateOne(
        { code: String(payload.couponCode).toUpperCase().trim() },
        { $inc: { usedCount: 1 } },
      );
    } catch { /* coupon counting must never break enrollment */ }
  }

  // Update course's enrolled count
  if (enrollment.status === 'active') {
    await Course.findByIdAndUpdate(payload.courseId, {
      $inc: { totalStudentsEnroll: 1 },
    });
  }

  // ── Notify admins about new order ───────
  await notifyAdmins();

  return enrollment;
};

// ─── Verify Payment & Activate ──────────────────────────────
const verifyPayment = async (transactionOrId: string, verifiedTrxId: string) => {
  // Try to find by transactionId first, then by _id
  let enrollment = await Enrollment.findOne({
    'payment.transactionId': transactionOrId,
    isDeleted: false,
  });
  if (!enrollment) {
    enrollment = await Enrollment.findById(transactionOrId);
  }
  if (!enrollment) throw new Error('Enrollment not found');

  enrollment.payment.status = 'paid';
  enrollment.payment.transactionId = verifiedTrxId || transactionOrId;
  enrollment.payment.paidAt = new Date();
  enrollment.status = 'active';

  // Batch is assigned manually by admin in the Enrollments page (Online/Offline).
  // Recorded courses need no batch — access is granted automatically once active.

  await enrollment.save();

  // Update course enrolled count
  await Course.findByIdAndUpdate(enrollment.courseId, {
    $inc: { totalStudentsEnroll: 1 },
  });

  return enrollment;
};



// ─── Get Student Enrollments ────────────────────────────────
const getStudentEnrollments = async (studentId: string) => {
  const enrollments = await Enrollment.find({ studentId, isDeleted: false })
    .populate({
      path: 'courseId',
      select: 'title image slug fee offerPrice type durationMonth lectures totalExam totalProject technology courseStart courseOverview details curriculum softwareYoullLearn jobPositions rating totalStudentsEnroll mentor',
      populate: {
        path: 'mentor',
        select: 'name image designation subject specialized_area education_qualification work_experience training_experience details lifeJourney',
      },
    })
    .populate({
      path: 'batchId',
      select: 'id name classDays classTime startDate endDate status maxStudents mentorId',
      populate: { path: 'mentorId', select: 'name image designation subject' },
    })
    .sort({ createdAt: -1 });
  return enrollments;
};

// ─── Get Course Enrollments (Admin) ─────────────────────────
const getCourseEnrollments = async (courseId: string) => {
  const enrollments = await Enrollment.find({ courseId, isDeleted: false })
    .populate('studentId', 'firstName lastName email phoneNumber')
    .populate('batchId', 'name')
    .sort({ createdAt: -1 });
  return enrollments;
};

// ─── Check if Student has Active Enrollment ─────────────────
const checkAccess = async (studentId: string, courseId: string) => {
  const enrollment = await Enrollment.findOne({
    studentId,
    courseId,
    status: 'active',
    isDeleted: false,
  });
  return { hasAccess: !!enrollment, enrollment };
};

// ─── Get All Enrollments (Admin) ────────────────────────────
const getAllEnrollments = async (query: {
  status?: string;
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
}) => {
  const { status, page = 1, limit = 20, includeDeleted = false } = query;
  const filter: any = {};
  if (!includeDeleted) {
    filter.isDeleted = false;
  }
  if (status) filter.status = status;

  const total = await Enrollment.countDocuments(filter);
  const enrollments = await Enrollment.find(filter)
    .populate('studentId', 'firstName lastName name email phoneNumber location gender')
    .populate('courseId', 'title image slug fee offerPrice type')
    .populate('batchId', 'name id')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    enrollments,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

// ─── Cancel Enrollment ──────────────────────────────────────
const cancelEnrollment = async (enrollmentId: string) => {
  const enrollment = await Enrollment.findByIdAndUpdate(
    enrollmentId,
    { status: 'cancelled' },
    { new: true }
  );
  if (!enrollment) throw new Error('Enrollment not found');
  return enrollment;
};

// ─── Admin: Manual Enroll ───────────────────────────────────
const adminEnroll = async (payload: {
  studentId: string;
  courseId: string;
  batchId?: string;
}) => {
  return createEnrollment({
    ...payload,
    payment: { amount: 0, method: 'manual' },
  });
};

// ─── Get Enrollment Stats ───────────────────────────────────
const getStats = async () => {
  const [total, active, pending, cancelled, pendingPayment] = await Promise.all([
    Enrollment.countDocuments({ isDeleted: false }),
    Enrollment.countDocuments({ status: 'active', isDeleted: false }),
    Enrollment.countDocuments({ status: 'pending', isDeleted: false }),
    Enrollment.countDocuments({ status: 'cancelled', isDeleted: false }),
    Enrollment.countDocuments({ 'payment.status': 'pending', isDeleted: false }),
  ]);

  // Revenue = admission (paid enrollments) + সব paid installment (Model A)
  const { Installment } = await import('../installment/installment.model');
  const [admissionResult, installmentResult] = await Promise.all([
    Enrollment.aggregate([
      { $match: { 'payment.status': 'paid', isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$payment.amount' } } },
    ]),
    Installment.aggregate([
      { $match: { status: 'paid', isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);
  const totalRevenue = (admissionResult[0]?.total || 0) + (installmentResult[0]?.total || 0);

  return {
    total,
    active,
    pending,
    cancelled,
    pendingPayment,
    totalRevenue,
  };
};

// ─── Approve Enrollment (Admin) ─────────────────────────────
const approveEnrollment = async (enrollmentId: string) => {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw new Error('Enrollment not found');
  if (enrollment.status === 'active') throw new Error('Already active');

  enrollment.status = 'active';
  enrollment.payment.status = 'paid';
  enrollment.payment.paidAt = new Date();

  // Batch is assigned manually by admin in the Enrollments page (Online/Offline).
  // Recorded courses need no batch — access is granted automatically once active.

  await enrollment.save();

  await Course.findByIdAndUpdate(enrollment.courseId, {
    $inc: { totalStudentsEnroll: 1 },
  });

  // PORT: notification module dropped — admission/full money-receipt email (fire-and-forget) disabled.
  // // Fire-and-forget admission/full money-receipt email (never blocks approval)
  // void (async () => {
  //   try {
  //     const full = await Enrollment.findById(enrollmentId)
  //       .populate('studentId', 'firstName lastName email phoneNumber')
  //       .populate('courseId', 'title fee offerPrice');
  //     const st: any = full?.studentId, co: any = full?.courseId;
  //     if (st?.email) {
  //       const paid = full?.payment?.amount || 0;
  //       // Agreed total = admin customFee, else the OFFER (discounted) price, else base fee — matches markPaidIfSettled.
  //       const priceNum = (v: any): number => (typeof v === 'number' ? v : parseInt(String(v || '').replace(/[^0-9]/g, ''), 10) || 0);
  //       const fee = (full as any)?.customFee || priceNum(co?.offerPrice) || priceNum(co?.fee);
  //       const hasFee = fee > 0;
  //       const due = hasFee ? Math.max(0, fee - paid) : 0;
  //       await EmailService.sendReceipt({
  //         to: st.email,
  //         name: `${st.firstName || ''} ${st.lastName || ''}`.trim() || 'Student',
  //         receiptType: due > 0 ? 'admission' : 'full',
  //         itemName: co?.title || 'Course',
  //         amount: paid,
  //         method: full?.payment?.method,
  //         transactionId: full?.payment?.transactionId,
  //         studentPhone: st.phoneNumber,
  //         totalFee: hasFee ? fee : undefined,
  //         totalPaid: paid,
  //         dueAmount: hasFee ? due : undefined,
  //         invoiceNumber: `ADM-${String(full?._id).slice(-8).toUpperCase()}`,
  //       });
  //     }
  //   } catch (e) { /* email errors never break approval */ }
  // })();

  return enrollment;
};

// ─── Get Student Payment History ────────────────────────────
const getStudentPayments = async (studentId: string) => {
  const enrollments = await Enrollment.find({ studentId, isDeleted: false })
    .populate('courseId', 'title image slug fee type')
    .sort({ createdAt: -1 });

  // Also fetch installments
  let installments: any[] = [];
  try {
    const { Installment } = await import('../installment/installment.model');
    installments = await Installment.find({ studentId, isDeleted: false })
      .populate('courseId', 'title')
      .sort({ dueDate: 1 });
  } catch (e) {
    console.error('Installment fetch failed:', e);
  }

  return { enrollments, installments };
};


// ─── Mentor: Get students in mentor's batches ──────────────
const getMentorStudents = async (userId: string) => {
  // Find mentor by userId
  const { Mentor } = await import('../mentor/mentor.model');
  // PORT: batch module not yet ported — batch-based student lookup disabled.
  // const { Batch } = await import('../batch/batch.model');
  const mentor = await Mentor.findOne({ userId });
  if (!mentor) return { students: [], batches: [] };

  // PORT: batch module not yet ported — mentor's batches/students lookup disabled below.
  // // Find all batches assigned to this mentor
  // const mentorBatches = await Batch.find({ mentorId: mentor._id, isDeleted: false })
  //   .populate('courseId', 'title image type')
  //   .lean();
  //
  // if (mentorBatches.length === 0) return { students: [], batches: mentorBatches };
  //
  // const batchIds = mentorBatches.map(b => b._id);
  //
  // // Find all enrollments in those batches
  // const students = await Enrollment.find({
  //   batchId: { $in: batchIds },
  //   isDeleted: false,
  // })
  //   .populate('studentId', 'firstName lastName name email phoneNumber')
  //   .populate('courseId', 'title image slug fee')
  //   .populate('batchId', 'id name courseName classTime classDays')
  //   .sort({ createdAt: -1 })
  //   .lean();
  //
  // return { students, batches: mentorBatches };
  return { students: [], batches: [] };
};


// ─── Admin: Transfer student to another course ────────────
const transferCourse = async (enrollmentId: string, newCourseId: string, newBatchId?: string) => {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw new Error('Enrollment not found');

  const oldCourseId = enrollment.courseId;

  // Real conflict: student is actively enrolled in the target course
  const activeExisting = await Enrollment.findOne({
    studentId: enrollment.studentId,
    courseId: newCourseId,
    status: { $in: ['active', 'pending'] },
    isDeleted: false,
  });
  if (activeExisting) throw new Error('Student is already enrolled in the target course');

  // Remove any stale enrollment (deleted/cancelled/expired/completed) for the target course —
  // the unique { studentId, courseId } index counts these too and would reject the transfer.
  const staleForTarget = await Enrollment.find({
    studentId: enrollment.studentId,
    courseId: newCourseId,
    _id: { $ne: enrollment._id },
    status: { $nin: ['active', 'pending'] },
  }).select('_id');
  if (staleForTarget.length) {
    const staleIds = staleForTarget.map(s => s._id);
    const { Installment } = await import('../installment/installment.model');
    await Installment.deleteMany({ enrollmentId: { $in: staleIds } });
    await Enrollment.deleteMany({ _id: { $in: staleIds } });
  }

  // Update enrollment to new course
  enrollment.courseId = newCourseId as any;
  enrollment.batchId = newBatchId ? (newBatchId as any) : undefined;
  enrollment.completionPercent = 0;
  enrollment.studentStatus = 'active';
  await enrollment.save();

  // Update old course count
  await Course.findByIdAndUpdate(oldCourseId, { $inc: { totalStudentsEnroll: -1 } });
  // Update new course count
  await Course.findByIdAndUpdate(newCourseId, { $inc: { totalStudentsEnroll: 1 } });

  return enrollment;
};

// ─── Soft-delete Enrollment (from Enrollments page) ────────
// Sets enrollment status to 'deleted' so Orders page shows "Deleted" status
const softDeleteEnrollment = async (enrollmentId: string) => {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw new Error('Enrollment not found');

  // Decrease course enrolled count if it was active
  if (enrollment.status === 'active') {
    await Course.findByIdAndUpdate(enrollment.courseId, {
      $inc: { totalStudentsEnroll: -1 },
    });
  }

  enrollment.status = 'deleted' as any;
  enrollment.isDeleted = true;
  await enrollment.save();

  return enrollment;
};

// ─── Hard-delete Order (from Orders page) ──────────────────
// Completely removes the enrollment document from the database
const hardDeleteOrder = async (enrollmentId: string) => {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw new Error('Order not found');

  // Decrease course enrolled count if it was active
  if (enrollment.status === 'active') {
    await Course.findByIdAndUpdate(enrollment.courseId, {
      $inc: { totalStudentsEnroll: -1 },
    });
  }

  // Also delete related installments if any
  try {
    const { Installment } = await import('../installment/installment.model');
    await Installment.deleteMany({ enrollmentId: enrollment._id });
  } catch (e) {
    console.error('Installment cleanup failed:', e);
  }

  await Enrollment.findByIdAndDelete(enrollmentId);

  return { message: 'Order deleted permanently' };
};

export const EnrollmentService = {
  createEnrollment,
  verifyPayment,
  getStudentEnrollments,
  getCourseEnrollments,
  checkAccess,
  getAllEnrollments,
  cancelEnrollment,
  adminEnroll,
  getStats,
  approveEnrollment,
  getStudentPayments,
  getMentorStudents,
  transferCourse,
  softDeleteEnrollment,
  hardDeleteOrder,
};
