import { Installment } from './installment.model';
import { Enrollment } from '../enrollment/enrollment.model';
import { Course } from '../courses/course.model';
// PORT: notification module dropped — EmailService (money-receipt emails) disabled.
// import { EmailService } from '../notification/email.service';

// fee/offerPrice are stored as strings ("৳6,000"); extract the numeric value.
const parsePrice = (v: any): number => {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (!v) return 0;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
};

// ─── Create Installment Plan ──────────────────────────────
const createPlan = async (payload: {
  enrollmentId: string;
  studentId: string;
  courseId: string;
  totalAmount: number;
  numberOfInstallments: number;
  firstDueDate: Date;
  intervalDays?: number;
}) => {
  const {
    enrollmentId, studentId, courseId,
    totalAmount, numberOfInstallments,
    firstDueDate, intervalDays = 30,
  } = payload;

  const amountPerInstallment = Math.ceil(totalAmount / numberOfInstallments);
  const installments = [];

  for (let i = 0; i < numberOfInstallments; i++) {
    const dueDate = new Date(firstDueDate);
    dueDate.setDate(dueDate.getDate() + (i * intervalDays));

    // First installment might be slightly different to handle rounding
    const amount = i === numberOfInstallments - 1
      ? totalAmount - (amountPerInstallment * (numberOfInstallments - 1))
      : amountPerInstallment;

    installments.push({
      enrollmentId,
      studentId,
      courseId,
      installmentNumber: i + 1,
      amount,
      dueDate,
      status: i === 0 ? 'due' : 'upcoming',
    });
  }

  const created = await Installment.insertMany(installments);
  return created;
};

// ─── Get Student Installments ─────────────────────────────
const getStudentInstallments = async (studentId: string) => {
  return Installment.find({ studentId, isDeleted: false })
    .populate('courseId', 'title image fee')
    .populate('enrollmentId', 'status')
    .sort({ dueDate: 1 });
};

// ─── Get Installments by Enrollment ──────────────────────
const getByEnrollment = async (enrollmentId: string) => {
  return Installment.find({ enrollmentId, isDeleted: false })
    .sort({ installmentNumber: 1 });
};

// ─── Mark enrollment fully paid if the total is settled ───
// admission + সব paid installment ≥ চূড়ান্ত fee হলে payment.status = 'paid'।
// শুধু upgrade করে (কখনো 'paid' → pending নামায় না — admission verified থাকে)।
const markPaidIfSettled = async (enrollmentId: any) => {
  const enrollment: any = await Enrollment.findById(enrollmentId).populate('courseId', 'fee offerPrice');
  if (!enrollment) return;
  // Agreed total = admin customFee, else the OFFER price (discounted), else the base fee.
  const defaultFee = parsePrice(enrollment.courseId?.offerPrice) || parsePrice(enrollment.courseId?.fee);
  const agreedTotal = Number(enrollment.customFee) || defaultFee;
  if (agreedTotal <= 0) return;

  const paid = await Installment.aggregate([
    { $match: { enrollmentId: enrollment._id, status: 'paid', isDeleted: false } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const totalPaid = (enrollment.payment?.amount || 0) + (paid[0]?.total || 0);

  if (totalPaid >= agreedTotal && enrollment.payment?.status !== 'paid') {
    enrollment.payment.status = 'paid';
    enrollment.payment.paidAt = enrollment.payment.paidAt || new Date();
    await enrollment.save();
  }
};

// ─── Pay Installment ─────────────────────────────────────
const payInstallment = async (installmentId: string, payload: {
  transactionId: string;
  method: string;
}) => {
  const installment = await Installment.findById(installmentId);
  if (!installment) throw new Error('Installment not found');
  if (installment.status === 'paid') throw new Error('Already paid');

  installment.status = 'paid';
  installment.paidDate = new Date();
  installment.transactionId = payload.transactionId;
  installment.method = payload.method;
  await installment.save();

  // Check if all installments are paid → activate enrollment
  const allInstallments = await Installment.find({
    enrollmentId: installment.enrollmentId,
    isDeleted: false,
  });
  const allPaid = allInstallments.every(i => i.status === 'paid');
  const firstPaid = allInstallments.some(i => i.status === 'paid');

  // Activate enrollment on first payment (never downgrade admission).
  if (firstPaid) {
    await Enrollment.findByIdAndUpdate(installment.enrollmentId, { status: 'active' });
  }
  // Fully paid (admission + paid installments ≥ চূড়ান্ত fee) হলে payment.status = 'paid'
  await markPaidIfSettled(installment.enrollmentId);

  // Mark next installment as 'due'
  if (!allPaid) {
    const nextInstallment = allInstallments
      .filter(i => i.status === 'upcoming')
      .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
    if (nextInstallment) {
      nextInstallment.status = 'due';
      await nextInstallment.save();
    }
  }

  // PORT: notification module dropped — money-receipt email (fire-and-forget) disabled.
  // // Fire-and-forget installment/full money-receipt email (never blocks payment)
  // void (async () => {
  //   try {
  //     const enr = await Enrollment.findById(installment.enrollmentId)
  //       .populate('studentId', 'firstName lastName email phoneNumber')
  //       .populate('courseId', 'title fee offerPrice');
  //     const st: any = enr?.studentId, co: any = enr?.courseId;
  //     if (st?.email) {
  //       const admission = enr?.payment?.amount || 0;
  //       const paidInst = allInstallments.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
  //       const totalPaid = admission + paidInst;
  //       const fee = (enr as any)?.customFee || parsePrice(co?.offerPrice) || parsePrice(co?.fee);
  //       const due = fee ? Math.max(0, fee - totalPaid) : 0;
  //       await EmailService.sendReceipt({
  //         to: st.email,
  //         name: `${st.firstName || ''} ${st.lastName || ''}`.trim() || 'Student',
  //         receiptType: (allPaid || (fee && due <= 0)) ? 'full' : 'installment',
  //         itemName: co?.title || 'Course',
  //         amount: installment.amount,
  //         method: installment.method || payload.method,
  //         transactionId: installment.transactionId,
  //         studentPhone: st.phoneNumber,
  //         installmentNumber: installment.installmentNumber,
  //         totalFee: fee || undefined,
  //         totalPaid,
  //         dueAmount: fee ? due : undefined,
  //         invoiceNumber: `INS-${String(installment._id).slice(-6).toUpperCase()}`,
  //       });
  //     }
  //   } catch (e) { /* email errors never break payment */ }
  // })();

  return installment;
};

// ─── Student: Pay toward due (records a paid installment) ──
// Admin কোনো plan না বানালেও student বাকি টাকা এখান থেকে দিতে পারবে।
const payDue = async (
  studentId: string,
  payload: { enrollmentId: string; amount: number; transactionId?: string; method?: string; notes?: string },
) => {
  const enrollment = await Enrollment.findOne({
    _id: payload.enrollmentId,
    studentId,
    isDeleted: false,
  });
  if (!enrollment) throw new Error('Enrollment not found');

  const amount = Number(payload.amount) || 0;
  if (amount <= 0) throw new Error('Amount must be greater than 0');

  const last = await Installment.findOne({ enrollmentId: payload.enrollmentId })
    .sort({ installmentNumber: -1 })
    .lean();
  const nextNumber = (last?.installmentNumber || 0) + 1;

  const installment = await Installment.create({
    enrollmentId: enrollment._id,
    studentId,
    courseId: enrollment.courseId,
    installmentNumber: nextNumber,
    amount,
    dueDate: new Date(),
    paidDate: new Date(),
    status: 'paid',
    method: payload.method || 'manual',
    transactionId: payload.transactionId,
    notes: payload.notes || 'Student paid from dashboard',
    isDeleted: false,
  });
  await markPaidIfSettled(enrollment._id);

  // PORT: notification module dropped — money-receipt email (fire-and-forget) disabled.
  // // Fire-and-forget money-receipt email — same as payInstallment (never blocks payment)
  // void (async () => {
  //   try {
  //     const enr = await Enrollment.findById(enrollment._id)
  //       .populate('studentId', 'firstName lastName email phoneNumber')
  //       .populate('courseId', 'title fee offerPrice');
  //     const st: any = enr?.studentId, co: any = enr?.courseId;
  //     if (st?.email) {
  //       const all = await Installment.find({ enrollmentId: enrollment._id, isDeleted: false });
  //       const allPaid = all.length > 0 && all.every(i => i.status === 'paid');
  //       const admission = (enr as any)?.payment?.amount || 0;
  //       const paidInst = all.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
  //       const totalPaid = admission + paidInst;
  //       const fee = (enr as any)?.customFee || parsePrice(co?.offerPrice) || parsePrice(co?.fee);
  //       const due = fee ? Math.max(0, fee - totalPaid) : 0;
  //       await EmailService.sendReceipt({
  //         to: st.email,
  //         name: `${st.firstName || ''} ${st.lastName || ''}`.trim() || 'Student',
  //         receiptType: (allPaid || (fee && due <= 0)) ? 'full' : 'installment',
  //         itemName: co?.title || 'Course',
  //         amount: installment.amount,
  //         method: installment.method || payload.method || 'manual',
  //         transactionId: installment.transactionId,
  //         studentPhone: st.phoneNumber,
  //         installmentNumber: installment.installmentNumber,
  //         totalFee: fee || undefined,
  //         totalPaid,
  //         dueAmount: fee ? due : undefined,
  //         invoiceNumber: `INS-${String(installment._id).slice(-6).toUpperCase()}`,
  //       });
  //     }
  //   } catch (e) { /* email errors never break payment */ }
  // })();

  return installment;
};

// ─── Admin: Verify Installment Payment ────────────────────
const adminVerify = async (installmentId: string) => {
  return payInstallment(installmentId, {
    transactionId: `ADMIN_VERIFY_${Date.now()}`,
    method: 'admin_verified',
  });
};

// ─── Get All Installments (Admin) ─────────────────────────
const getAllInstallments = async (query: { status?: string }) => {
  const filter: any = { isDeleted: false };
  if (query.status) filter.status = query.status;

  return Installment.find(filter)
    .populate('studentId', 'firstName lastName email phoneNumber')
    .populate('courseId', 'title fee')
    .populate('enrollmentId', 'status')
    .sort({ dueDate: 1 });
};

// ─── Update Overdue Status (call via cron/manual) ─────────
const updateOverdueStatus = async () => {
  const now = new Date();
  const result = await Installment.updateMany(
    {
      status: { $in: ['upcoming', 'due'] },
      dueDate: { $lt: now },
      isDeleted: false,
    },
    { $set: { status: 'overdue' } }
  );
  return result;
};

// ─── Get Installment Stats (Admin) ────────────────────────
const getStats = async () => {
  const [total, paid, due, overdue] = await Promise.all([
    Installment.countDocuments({ isDeleted: false }),
    Installment.countDocuments({ status: 'paid', isDeleted: false }),
    Installment.countDocuments({ status: 'due', isDeleted: false }),
    Installment.countDocuments({ status: 'overdue', isDeleted: false }),
  ]);

  const revenueResult = await Installment.aggregate([
    { $match: { status: 'paid', isDeleted: false } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  const overdueAmount = await Installment.aggregate([
    { $match: { status: 'overdue', isDeleted: false } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  return {
    total, paid, due, overdue,
    totalCollected: revenueResult[0]?.total || 0,
    totalOverdue: overdueAmount[0]?.total || 0,
  };
};

export const InstallmentService = {
  createPlan,
  getStudentInstallments,
  getByEnrollment,
  payInstallment,
  payDue,
  markPaidIfSettled,
  adminVerify,
  getAllInstallments,
  updateOverdueStatus,
  getStats,
};
