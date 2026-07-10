/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Enrollment } from '../enrollment/enrollment.model';
import { Course } from '../courses/course.model';
import { User } from '../user/user.model';
// TODO(integration): the following modules are not yet ported — restore these imports once available.
// import { Certificate } from '../certificate/certificate.model';
// import { ClassSchedule } from '../classSchedule/classSchedule.model';
// import { Exam, ExamSubmission } from '../exam/exam.model';
// import { Batch } from '../batch/batch.model';
// import { Attendance } from '../attendance/attendance.model';
import { Installment } from '../installment/installment.model';
import { InstallmentService } from '../installment/installment.service';
// import { IeltsMockPurchase } from '../ielts/mock/mock.model'; // not yet ported

// ─── Helper: Parse date range from query ────────────────────
const getDateRange = (req: Request) => {
  const { startDate, endDate } = req.query;
  const filter: any = {};
  if (startDate) filter.$gte = new Date(startDate as string);
  if (endDate) {
    const end = new Date(endDate as string);
    end.setHours(23, 59, 59, 999);
    filter.$lte = end;
  }
  return Object.keys(filter).length > 0 ? filter : null;
};

// ─── Helper: Get month range ────────────────────────────────
const getMonthRange = (year: number, month: number) => {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

// ─── Helper: numeric price parse (fee/offerPrice are stored as strings) ──
const parsePrice = (v: any): number => {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (!v) return 0;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
};

// Actual money for a PAID enrollment. Prefer the recorded amount; if it's missing
// use the agreed customFee, then the OFFER price (discounted), then the base fee.
// Free enrollments contribute 0 — and never fall back to the full `fee` over an offer.
const paidEnrollmentAmount = (e: any): number => {
  const amt = Number(e?.payment?.amount);
  if (amt > 0) return amt;
  if (e?.payment?.method === 'free') return 0;
  const custom = parsePrice(e?.customFee);
  if (custom > 0) return custom;
  const course = e?.courseId || {};
  return parsePrice(course.offerPrice) || parsePrice(course.fee);
};

// ─── Dashboard Stats (supports date filter) ─────────────────
const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const dateRange = getDateRange(req);
    const dateFilter = dateRange ? { createdAt: dateRange } : {};

    const [
      totalStudents, totalCourses, totalMentors,
      totalEnrollments, activeEnrollments, pendingPayments,
      totalCertificates, totalClasses,
    ] = await Promise.all([
      User.countDocuments({ role: 'student', isDeleted: { $ne: true }, ...dateFilter }),
      Course.countDocuments({ isDeleted: false, ...dateFilter }),
      User.countDocuments({ role: 'mentor', isDeleted: { $ne: true }, ...dateFilter }),
      Enrollment.countDocuments({ isDeleted: false, ...dateFilter }),
      Enrollment.countDocuments({ status: 'active', isDeleted: false, ...dateFilter }),
      Enrollment.countDocuments({ 'payment.status': 'pending', isDeleted: false, ...dateFilter }),
      // TODO(integration): certificate not yet ported → restore when available
      // Certificate.countDocuments({ status: 'active', isDeleted: false, ...dateFilter }),
      Promise.resolve(0),
      // TODO(integration): classSchedule not yet ported → restore when available
      // ClassSchedule.countDocuments({ isDeleted: false, ...dateFilter }),
      Promise.resolve(0),
    ]);

    res.json({
      success: true, data: {
        totalStudents, totalCourses, totalMentors,
        totalEnrollments, activeEnrollments, pendingPayments,
        totalCertificates, totalClasses,
      },
    });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Monthly Dashboard (for Dashboard Home) ─────────────────
const getMonthlyDashboard = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) ?? now.getMonth();
    const monthIdx = month >= 0 && month <= 11 ? month : now.getMonth();

    const { start: currentStart, end: currentEnd } = getMonthRange(year, monthIdx);
    // Previous month
    const prevDate = new Date(year, monthIdx - 1, 1);
    const { start: prevStart, end: prevEnd } = getMonthRange(prevDate.getFullYear(), prevDate.getMonth());

    const currentFilter = { createdAt: { $gte: currentStart, $lte: currentEnd } };
    const prevFilter = { createdAt: { $gte: prevStart, $lte: prevEnd } };

    const [
      // Current month
      newStudents, newEnrollments, pendingOrders,
      currentPaidEnrollments, newBatches, newCourses,
      // Previous month
      prevStudents, prevEnrollments, prevPendingOrders,
      prevPaidEnrollments, prevBatches, prevCourses,
      // TOTAL COUNTS (all-time)
      totalCourses, totalBatches, runningBatches, totalStudents, totalEnrollments,
      // Revenue from installments
      currentInstallments, prevInstallments,
    ] = await Promise.all([
      // Current
      User.countDocuments({ role: 'student', isDeleted: { $ne: true }, ...currentFilter }),
      Enrollment.countDocuments({ isDeleted: false, ...currentFilter }),
      Enrollment.countDocuments({ 'payment.status': 'pending', isDeleted: false, ...currentFilter }),
      Enrollment.find({ 'payment.status': 'paid', isDeleted: false, ...currentFilter }).populate('courseId', 'fee offerPrice'),
      // TODO(integration): batch not yet ported → restore when available
      // Batch.countDocuments({ isDeleted: { $ne: true }, ...currentFilter }),
      Promise.resolve(0),
      Course.countDocuments({ isDeleted: false, ...currentFilter }),
      // Previous
      User.countDocuments({ role: 'student', isDeleted: { $ne: true }, ...prevFilter }),
      Enrollment.countDocuments({ isDeleted: false, ...prevFilter }),
      Enrollment.countDocuments({ 'payment.status': 'pending', isDeleted: false, ...prevFilter }),
      Enrollment.find({ 'payment.status': 'paid', isDeleted: false, ...prevFilter }).populate('courseId', 'fee offerPrice'),
      // TODO(integration): batch not yet ported → restore when available
      // Batch.countDocuments({ isDeleted: { $ne: true }, ...prevFilter }),
      Promise.resolve(0),
      Course.countDocuments({ isDeleted: false, ...prevFilter }),
      // ALL-TIME totals
      Course.countDocuments({ isDeleted: false }),
      // TODO(integration): batch not yet ported → restore when available
      // Batch.countDocuments({ isDeleted: { $ne: true } }),
      Promise.resolve(0),
      // Batch.countDocuments({ status: { $in: ['active', 'running'] }, isDeleted: { $ne: true } }),
      Promise.resolve(0),
      User.countDocuments({ role: 'student', isDeleted: { $ne: true } }),
      Enrollment.countDocuments({ status: 'active', isDeleted: false }),
      // Installment-based revenue for current & prev month (use paidDate not paidAt)
      Installment.find({
        status: 'paid',
        isDeleted: false,
        paidDate: { $gte: currentStart, $lte: currentEnd },
      }).lean(),
      Installment.find({
        status: 'paid',
        isDeleted: false,
        paidDate: { $gte: prevStart, $lte: prevEnd },
      }).lean(),
    ]);

    // Revenue from installments (actual payments received)
    let currentInstallmentRevenue = currentInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
    let prevInstallmentRevenue = prevInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

    // If paidDate-based query returned 0, also try createdAt-based (some installments may not have paidDate set)
    if (currentInstallmentRevenue === 0) {
      const fallbackCurrent = await Installment.find({
        status: 'paid', isDeleted: false,
        createdAt: { $gte: currentStart, $lte: currentEnd },
      }).lean();
      currentInstallmentRevenue = fallbackCurrent.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
    }
    if (prevInstallmentRevenue === 0) {
      const fallbackPrev = await Installment.find({
        status: 'paid', isDeleted: false,
        createdAt: { $gte: prevStart, $lte: prevEnd },
      }).lean();
      prevInstallmentRevenue = fallbackPrev.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
    }

    // Fallback: enrollment-based revenue (payment.amount or course fee)
    const currentEnrollmentRevenue = currentPaidEnrollments.reduce((sum, e) => sum + paidEnrollmentAmount(e), 0);
    const prevEnrollmentRevenue = prevPaidEnrollments.reduce((sum, e) => sum + paidEnrollmentAmount(e), 0);

    const currentRevenue = currentInstallmentRevenue > 0 ? currentInstallmentRevenue : currentEnrollmentRevenue;
    const prevRevenue = prevInstallmentRevenue > 0 ? prevInstallmentRevenue : prevEnrollmentRevenue;

    // ── Due Payment Stats ──
    // All due/overdue installments (total outstanding)
    const allDueInstallments = await Installment.find({
      status: { $in: ['due', 'overdue'] },
      isDeleted: false,
    }).lean();
    const totalDueAmount = allDueInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

    // Unique students with dues
    const studentsWithDue = new Set(allDueInstallments.map((i: any) => i.studentId?.toString())).size;

    // Due collected this month (installments that were paid this month)
    const dueCollectedThisMonth = currentInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
    const dueCollectedPrevMonth = prevInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

    // Overdue count
    const overdueCount = allDueInstallments.filter((i: any) => i.status === 'overdue' || (i.status === 'due' && new Date(i.dueDate) < new Date())).length;
    const overdueAmount = allDueInstallments
      .filter((i: any) => i.status === 'overdue' || (i.status === 'due' && new Date(i.dueDate) < new Date()))
      .reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

    const calcChange = (current: number, prev: number) => {
      if (prev === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - prev) / prev) * 100);
    };

    res.json({
      success: true,
      data: {
        period: { year, month: monthIdx, label: currentStart.toLocaleDateString('en', { month: 'long', year: 'numeric' }) },
        current: {
          newStudents,
          newEnrollments,
          pendingOrders,
          revenue: currentRevenue,
          paidOrders: currentPaidEnrollments.length,
          newBatches,
          newCourses,
        },
        // ALL-TIME totals
        totals: {
          totalCourses,
          totalBatches,
          runningBatches,
          totalStudents,
          totalEnrollments,
        },
        // Due payment stats
        dues: {
          studentsWithDue,
          totalDueAmount,
          dueCollectedThisMonth,
          dueCollectedPrevMonth,
          overdueCount,
          overdueAmount,
          dueCollectionChange: calcChange(dueCollectedThisMonth, dueCollectedPrevMonth),
        },
        changes: {
          students: calcChange(newStudents, prevStudents),
          enrollments: calcChange(newEnrollments, prevEnrollments),
          pendingOrders: calcChange(pendingOrders, prevPendingOrders),
          revenue: calcChange(currentRevenue, prevRevenue),
          batches: calcChange(newBatches, prevBatches),
          courses: calcChange(newCourses, prevCourses),
        },
        previous: {
          newStudents: prevStudents,
          newEnrollments: prevEnrollments,
          pendingOrders: prevPendingOrders,
          revenue: prevRevenue,
          paidOrders: prevPaidEnrollments.length,
          newBatches: prevBatches,
          newCourses: prevCourses,
        },
      },
    });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Enrollment Trends (supports date filter) ───────────────
const getEnrollmentTrends = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    let rangeStart: Date, rangeEnd: Date;

    if (startDate && endDate) {
      rangeStart = new Date(startDate as string);
      rangeEnd = new Date(endDate as string);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      rangeEnd = new Date();
      rangeStart = new Date();
      rangeStart.setMonth(rangeStart.getMonth() - 11);
      rangeStart.setDate(1);
      rangeStart.setHours(0, 0, 0, 0);
    }

    const months = [];
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0);

    while (cursor <= endMonth) {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
      const count = await Enrollment.countDocuments({ createdAt: { $gte: start, $lte: end } });
      months.push({
        month: start.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
        count,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    res.json({ success: true, data: months });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Revenue by Month (supports date filter) ────────────────
const getRevenueByMonth = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    let rangeStart: Date, rangeEnd: Date;

    if (startDate && endDate) {
      rangeStart = new Date(startDate as string);
      rangeEnd = new Date(endDate as string);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      rangeEnd = new Date();
      rangeStart = new Date();
      rangeStart.setMonth(rangeStart.getMonth() - 11);
      rangeStart.setDate(1);
      rangeStart.setHours(0, 0, 0, 0);
    }

    const months = [];
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0);

    while (cursor <= endMonth) {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);

      // Try installment-based revenue first
      const paidInstallments = await Installment.find({
        status: 'paid', isDeleted: false,
        $or: [
          { paidDate: { $gte: start, $lte: end } },
          { paidDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
        ],
      }).lean();
      let revenue = paidInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

      // Fallback to enrollment-based
      if (revenue === 0) {
        const enrollments = await Enrollment.find({
          'payment.status': 'paid', isDeleted: false,
          createdAt: { $gte: start, $lte: end },
        }).populate('courseId', 'fee offerPrice');
        revenue = enrollments.reduce((sum, e) => sum + paidEnrollmentAmount(e), 0);
      }

      months.push({
        month: start.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
        revenue,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    res.json({ success: true, data: months });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Popular Courses (supports date filter) ─────────────────
const getPopularCourses = async (req: Request, res: Response) => {
  try {
    const dateRange = getDateRange(req);
    const dateFilter = dateRange ? { createdAt: dateRange } : {};

    const courses = await Course.find({ isDeleted: false }).select('title image fee');
    const result = await Promise.all(courses.map(async (c) => {
      const count = await Enrollment.countDocuments({ courseId: c._id, ...dateFilter });
      return { courseId: c._id, title: c.title, image: c.image, fee: c.fee, enrollments: count };
    }));
    result.sort((a, b) => b.enrollments - a.enrollments);
    res.json({ success: true, data: result.slice(0, 10) });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Revenue Summary (supports date filter) ─────────────────
const getRevenueSummary = async (req: Request, res: Response) => {
  try {
    const dateRange = getDateRange(req);
    const dateFilter = dateRange ? { createdAt: dateRange } : {};

    // Installment-based total revenue
    const allPaidInstallments = await Installment.find({ status: 'paid', isDeleted: false, ...dateFilter }).lean();
    const installmentRevenue = allPaidInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

    // Enrollment-based fallback
    const allPaidEnrollments = await Enrollment.find({ 'payment.status': 'paid', isDeleted: false, ...dateFilter }).populate('courseId', 'fee offerPrice');
    const enrollmentRevenue = allPaidEnrollments.reduce((sum, e) => sum + paidEnrollmentAmount(e), 0);

    const totalRevenue = installmentRevenue > 0 ? installmentRevenue : enrollmentRevenue;

    // This month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const thisMonthInstallments = await Installment.find({
      status: 'paid', isDeleted: false,
      $or: [
        { paidDate: { $gte: monthStart, $lte: monthEnd } },
        { paidDate: { $exists: false }, createdAt: { $gte: monthStart, $lte: monthEnd } },
      ],
    }).lean();
    let thisMonthRevenue = thisMonthInstallments.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

    if (thisMonthRevenue === 0) {
      const thisMonthEnrollments = allPaidEnrollments.filter(e => new Date(e.createdAt as any) >= monthStart);
      thisMonthRevenue = thisMonthEnrollments.reduce((sum, e) => sum + paidEnrollmentAmount(e), 0);
    }

    // Payment method breakdown from installments
    const methods: Record<string, number> = {};
    if (allPaidInstallments.length > 0) {
      allPaidInstallments.forEach((i: any) => {
        const m = i.method || 'other';
        methods[m] = (methods[m] || 0) + (i.amount || 0);
      });
    } else {
      allPaidEnrollments.forEach(e => {
        const m = (e as any).payment?.method || 'other';
        methods[m] = (methods[m] || 0) + paidEnrollmentAmount(e);
      });
    }

    res.json({
      success: true, data: {
        totalRevenue, thisMonthRevenue,
        totalTransactions: allPaidInstallments.length > 0 ? allPaidInstallments.length : allPaidEnrollments.length,
        paymentMethods: Object.entries(methods).map(([method, amount]) => ({ method, amount })),
        isFiltered: !!dateRange,
      },
    });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Student Growth (supports date filter) ──────────────────
const getStudentGrowth = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    let rangeStart: Date, rangeEnd: Date;

    if (startDate && endDate) {
      rangeStart = new Date(startDate as string);
      rangeEnd = new Date(endDate as string);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      rangeEnd = new Date();
      rangeStart = new Date();
      rangeStart.setMonth(rangeStart.getMonth() - 11);
      rangeStart.setDate(1);
      rangeStart.setHours(0, 0, 0, 0);
    }

    const months = [];
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const endMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0);

    while (cursor <= endMonth) {
      const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
      const count = await User.countDocuments({ role: 'student', createdAt: { $lte: end } });
      months.push({
        month: end.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
        count,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    res.json({ success: true, data: months });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Daily Sales for a specific month ───────────────────────
const getDailySales = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) ?? now.getMonth();
    const monthIdx = month >= 0 && month <= 11 ? month : now.getMonth();

    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const dailyData = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStart = new Date(year, monthIdx, day, 0, 0, 0, 0);
      const dayEnd = new Date(year, monthIdx, day, 23, 59, 59, 999);
      const count = await Enrollment.countDocuments({
        createdAt: { $gte: dayStart, $lte: dayEnd },
      });
      dailyData.push({ day, count });
    }

    res.json({ success: true, data: dailyData });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Enrollment Distribution by Course Type (Online/Offline/Recorded) ─
const getTypeDistribution = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) ?? now.getMonth();
    const monthIdx = month >= 0 && month <= 11 ? month : now.getMonth();

    const start = new Date(year, monthIdx, 1);
    const end = new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);

    // Get enrollments for the month with course data
    const enrollments = await Enrollment.find({
      createdAt: { $gte: start, $lte: end },
    }).populate('courseId', 'type');

    const typeCounts: Record<string, number> = {};
    enrollments.forEach(e => {
      const courseType = (e.courseId as any)?.type || 'Other';
      // Normalize type names
      const normalized = courseType.charAt(0).toUpperCase() + courseType.slice(1).toLowerCase();
      typeCounts[normalized] = (typeCounts[normalized] || 0) + 1;
    });

    const data = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data,
      total: enrollments.length,
    });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Batch Overview (upcoming, running, completed + enrollment counts) ──
const getBatchOverview = async (req: Request, res: Response) => {
  try {
    // TODO(integration): batch not yet ported — stub response; original preserved in block comment below.
    // Restore by removing this stub and the surrounding /* ORIGINAL ... */ wrapper once `batch` is ported.
    res.json({
      success: true,
      data: {
        summary: { total: 0, upcoming: 0, running: 0, completed: 0 },
        upcoming: [],
        running: [],
        completed: [],
      },
    });
    /* ORIGINAL (restore when batch ported):
    const now = new Date();

    // Get all non-deleted batches
    const allBatches = await Batch.find({ isDeleted: { $ne: true } })
      .populate('courseId', 'title image type fee offerPrice')
      .populate('mentorId', 'name image designation')
      .sort({ startDate: 1 })
      .lean();

    // Categorize
    const upcoming: any[] = [];
    const running: any[] = [];
    const completed: any[] = [];

    for (const batch of allBatches) {
      const start = new Date(batch.startDate);
      const end = new Date(batch.endDate);

      // Count enrollments for this batch (exclude deleted)
      const enrollCount = await Enrollment.countDocuments({
        batchId: batch._id,
        isDeleted: false,
        status: { $ne: 'deleted' },
      });

      const batchData = {
        ...batch,
        enrolledStudents: enrollCount,
        seatsFilled: batch.maxStudents ? Math.round((enrollCount / batch.maxStudents) * 100) : 0,
      };

      if (batch.status === 'completed' || end < now) {
        completed.push(batchData);
      } else if (batch.status === 'active' || (start <= now && end >= now)) {
        running.push(batchData);
      } else {
        upcoming.push(batchData);
      }
    }

    res.json({
      success: true,
      data: {
        summary: {
          total: allBatches.length,
          upcoming: upcoming.length,
          running: running.length,
          completed: completed.length,
        },
        upcoming,
        running,
        completed,
      },
    });
    */
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ─── Batch Details (lazy-loaded per batch dropdown) ─────────
const getBatchDetails = async (req: Request, res: Response) => {
  try {
    // TODO(integration): batch/classSchedule/attendance/exam/certificate not yet ported — stub response;
    // original preserved in block comment below. Restore by removing this stub + the /* ORIGINAL ... */ wrapper.
    return res.status(404).json({ success: false, message: 'Batch module not yet ported' });
    /* ORIGINAL (restore when batch/classSchedule/attendance/exam/certificate ported):
    const { batchId } = req.params;

    // 1. Get batch info
    const batch = await Batch.findById(batchId)
      .populate('courseId', 'title image type fee offerPrice')
      .populate('mentorId', 'name image designation')
      .lean();

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    // 2. Get enrolled students for this batch
    const enrollments = await Enrollment.find({
      batchId: batchId,
      isDeleted: false,
      status: { $ne: 'deleted' },
    })
      .populate('studentId', 'firstName lastName name email phoneNumber image')
      .populate('courseId', 'title fee')
      .lean();

    // 3. Get class schedules for this batch
    const classes = await ClassSchedule.find({
      batchId: batchId,
      isDeleted: false,
    })
      .sort({ date: 1 })
      .lean();

    const totalClasses = classes.length;
    const completedClasses = classes.filter(c => c.status === 'completed').length;
    const upcomingClasses = classes.filter(c => c.status === 'scheduled').length;
    const cancelledClasses = classes.filter(c => c.status === 'cancelled').length;

    // 4. Get attendance records for this batch
    const attendanceRecords = await Attendance.find({
      batchId: batchId,
      isDeleted: false,
    }).lean();

    // Calculate overall attendance
    let totalPresent = 0;
    let totalRecords = 0;
    const perStudentAttendance: Record<string, { present: number; total: number; late: number }> = {};

    attendanceRecords.forEach(att => {
      att.records.forEach((r: any) => {
        const sid = r.studentId?.toString();
        if (!sid) return;
        if (!perStudentAttendance[sid]) {
          perStudentAttendance[sid] = { present: 0, total: 0, late: 0 };
        }
        perStudentAttendance[sid].total += 1;
        totalRecords += 1;
        if (r.status === 'present' || r.status === 'late') {
          perStudentAttendance[sid].present += 1;
          totalPresent += 1;
        }
        if (r.status === 'late') {
          perStudentAttendance[sid].late += 1;
        }
      });
    });

    const overallAttendancePct = totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

    // 5. Get exams/assignments for this batch's course
    const courseObjId = batch.courseId?._id || batch.courseId;
    const exams = await Exam.find({
      courseId: courseObjId,
      isDeleted: { $ne: true },
    }).lean();
    const totalExams = exams.length;
    const examIds = exams.map(e => e._id);

    // Get all submissions for these exams
    const allSubmissions = examIds.length > 0
      ? await ExamSubmission.find({ examId: { $in: examIds } }).lean()
      : [];

    // Per-student submission count
    const perStudentSubmissions: Record<string, number> = {};
    allSubmissions.forEach((sub: any) => {
      const sid = sub.studentId?.toString();
      if (sid) perStudentSubmissions[sid] = (perStudentSubmissions[sid] || 0) + 1;
    });

    // 6. Build student list with attendance % + assignments
    const students = enrollments.map(e => {
      const student = e.studentId as any;
      const sid = student?._id?.toString();
      const att = sid ? perStudentAttendance[sid] : undefined;
      const attendancePct = att && att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;

      return {
        _id: sid,
        enrollmentId: e._id,
        name: student ? `${student.firstName || student.name || ''} ${student.lastName || ''}`.trim() : 'Unknown',
        email: student?.email || '',
        phone: student?.phoneNumber || '',
        image: student?.image || '',
        enrollmentStatus: e.status,
        studentStatus: e.studentStatus || 'active',
        completionPercent: e.completionPercent || 0,
        paymentAmount: e.payment?.amount || 0,
        paymentStatus: e.payment?.status || 'pending',
        paymentMethod: e.payment?.method || '',
        enrolledAt: e.enrolledAt || e.createdAt,
        attendancePct,
        attendancePresent: att?.present || 0,
        attendanceTotal: att?.total || 0,
        attendanceLate: att?.late || 0,
        attendanceSessions: attendanceRecords.length,
        assignmentsSubmitted: sid ? (perStudentSubmissions[sid] || 0) : 0,
        assignmentsTotal: totalExams,
      };
    });

    // 6. Payment summary
    const totalPending = enrollments
      .filter(e => e.payment?.status === 'pending')
      .reduce((sum, e) => sum + (e.payment?.amount || 0), 0);

    const totalPaymentAmount = enrollments.reduce((sum, e) => sum + (e.payment?.amount || 0), 0);

    // Get installments for all enrollments in this batch
    const enrollmentIds = enrollments.map(e => e._id);
    const installments = await Installment.find({
      enrollmentId: { $in: enrollmentIds },
      isDeleted: false,
    }).lean();

    const installmentsPaid = installments.filter(i => i.status === 'paid').length;
    const installmentsDue = installments.filter(i => i.status === 'due' || i.status === 'overdue').length;
    const installmentsUpcoming = installments.filter(i => i.status === 'upcoming').length;
    const installmentPaidAmount = installments
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + (i.amount || 0), 0);
    const installmentDueAmount = installments
      .filter(i => i.status === 'due' || i.status === 'overdue')
      .reduce((sum, i) => sum + (i.amount || 0), 0);

    // 7. Certificates (for completed batches)
    const batchIdStr = (batch as any).id || batchId;
    const certificates = await Certificate.find({
      batchId: batchIdStr,
      isDeleted: false,
    }).lean();

    const activeCerts = certificates.filter(c => c.status === 'active').length;
    const pendingCerts = certificates.filter(c => c.status === 'pending').length;

    // ── Per-student payment breakdown (single source of truth) ──
    const perStudent = students.map(s => {
      const studentEnrollment = enrollments.find(e => (e.studentId as any)?._id?.toString() === s._id);
      const studentInstallments = installments.filter(i => i.enrollmentId?.toString() === studentEnrollment?._id?.toString());
      const sPaid = studentInstallments.filter(i => i.status === 'paid');
      const sDue = studentInstallments.filter(i => i.status === 'due' || i.status === 'overdue');
      const sUpcoming = studentInstallments.filter(i => i.status === 'upcoming');

      // Admission = checkout-এ দেওয়া টাকা (enrollment.payment.amount)
      const admissionPayment = studentEnrollment?.payment?.amount || 0;
      // Per-student মোট ফি: customFee থাকলে সেটা, নাহলে offer price (থাকলে), নাহলে মূল fee
      const defaultFee = parsePrice((batch.courseId as any)?.offerPrice) || parsePrice((batch.courseId as any)?.fee);
      const studentCoursePrice = Number((studentEnrollment as any)?.customFee) || defaultFee;
      // Total Paid = admission + সব paid installment
      const installmentsPaidTotal = sPaid.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
      const totalPaid = admissionPayment + installmentsPaidTotal;
      // Remaining due = মোট ফি − Total Paid
      const remainingDue = Math.max(0, studentCoursePrice - totalPaid);

      return {
        studentId: s._id,
        enrollmentId: studentEnrollment?._id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        image: s.image || '',
        enrolledAt: studentEnrollment?.enrolledAt || (studentEnrollment as any)?.createdAt,
        coursePrice: studentCoursePrice,
        defaultCoursePrice: defaultFee,
        hasCustomFee: !!(studentEnrollment as any)?.customFee,
        admissionPayment,
        totalPaid,
        remainingDue,
        totalDue: remainingDue,
        installmentCount: studentInstallments.length,
        paidCount: sPaid.length,
        dueCount: sDue.length,
        upcomingCount: sUpcoming.length,
        hasInstallmentPlan: studentInstallments.length > 0,
        installments: studentInstallments.map(i => ({
          _id: i._id,
          installmentNumber: i.installmentNumber,
          amount: i.amount,
          dueDate: i.dueDate,
          paidDate: (i as any).paidDate,
          status: i.status,
          method: (i as any).method,
          notes: (i as any).notes,
          transactionId: (i as any).transactionId,
        })).sort((a: any, b: any) => a.installmentNumber - b.installmentNumber),
      };
    });

    // Batch-wide totals — same per-student math থেকে derived
    const totalCollectedAll = perStudent.reduce((sum, p) => sum + (p.totalPaid || 0), 0);
    const totalRemainingDueAll = perStudent.reduce((sum, p) => sum + (p.remainingDue || 0), 0);

    res.json({
      success: true,
      data: {
        batch: {
          _id: batch._id,
          id: (batch as any).id,
          name: (batch as any).name,
          courseName: (batch as any).courseName,
          courseId: batch.courseId,
          mentorId: batch.mentorId,
          startDate: batch.startDate,
          endDate: batch.endDate,
          classTime: (batch as any).classTime,
          classDays: (batch as any).classDays,
          maxStudents: (batch as any).maxStudents,
          status: (batch as any).status,
        },
        classes: {
          total: totalClasses,
          completed: completedClasses,
          upcoming: upcomingClasses,
          cancelled: cancelledClasses,
          progressPct: totalClasses > 0 ? Math.round((completedClasses / totalClasses) * 100) : 0,
        },
        attendance: {
          overallPct: overallAttendancePct,
          totalSessions: attendanceRecords.length,
          totalPresent,
          totalRecords,
          // Raw grid data: each session with date, title, and per-student status
          grid: attendanceRecords
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((att: any) => ({
              _id: att._id,
              date: att.date,
              classTitle: att.classTitle || '',
              records: (att.records || []).map((r: any) => ({
                studentId: r.studentId?.toString(),
                status: r.status,
                note: r.note || '',
              })),
            })),
        },
        students,
        payment: {
          totalCollected: totalCollectedAll,
          totalPending,
          totalRemainingDue: totalRemainingDueAll,
          totalAmount: totalPaymentAmount,
          coursePrice: parsePrice((batch.courseId as any)?.offerPrice) || parsePrice((batch.courseId as any)?.fee),
          paidCount: enrollments.filter(e => e.payment?.status === 'paid').length,
          pendingCount: enrollments.filter(e => e.payment?.status === 'pending').length,
          installments: {
            total: installments.length,
            paid: installmentsPaid,
            due: installmentsDue,
            upcoming: installmentsUpcoming,
            paidAmount: installmentPaidAmount,
            dueAmount: installmentDueAmount,
          },
          perStudent,
        },
        certificates: {
          total: certificates.length,
          active: activeCerts,
          pending: pendingCerts,
        },
      },
    });
    */
  } catch (e: any) {
    console.error('getBatchDetails error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Update Student Status ──────────────────────────────────
const updateStudentStatus = async (req: Request, res: Response) => {
  try {
    const { enrollmentId, studentStatus } = req.body;
    if (!enrollmentId || !studentStatus) {
      return res.status(400).json({ success: false, message: 'enrollmentId and studentStatus required' });
    }
    const validStatuses = ['active', 'completed', 'dropout', 'inactive'];
    if (!validStatuses.includes(studentStatus)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be: ${validStatuses.join(', ')}` });
    }
    const enrollment = await Enrollment.findByIdAndUpdate(
      enrollmentId,
      { studentStatus },
      { new: true }
    );
    if (!enrollment) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }
    res.json({ success: true, data: enrollment });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Add Installment ────────────────────────────────────────
const addInstallment = async (req: Request, res: Response) => {
  try {
    const { enrollmentId, studentId, courseId, amount, dueDate, status, method, notes } = req.body;
    if (!enrollmentId || !studentId || !courseId || !amount) {
      return res.status(400).json({ success: false, message: 'enrollmentId, studentId, courseId, amount required' });
    }

    // Get the latest installment number
    const lastInstallment = await Installment.findOne({ enrollmentId })
      .sort({ installmentNumber: -1 })
      .lean();
    const nextNumber = (lastInstallment?.installmentNumber || 0) + 1;

    const installment = await Installment.create({
      enrollmentId,
      studentId,
      courseId,
      installmentNumber: nextNumber,
      amount,
      dueDate: dueDate || new Date(),
      paidDate: status === 'paid' ? new Date() : undefined,
      status: status || 'paid',
      method: method || 'manual',
      notes: notes || `Installment #${nextNumber}`,
      isDeleted: false,
    });

    // NOTE: enrollment.payment.amount = ভর্তি ফি (admission), installment আলাদা ledger।
    // তাই এখানে payment.amount overwrite করা হয় না — Total Paid live হিসাব হয়
    // (admission + সব paid installment), যাতে দুবার গোনা না হয়।

    // পুরো fee পরিশোধ হয়ে গেলে enrollment fully-paid mark হবে (সব জায়গায় reflect করবে)
    await InstallmentService.markPaidIfSettled(enrollmentId);

    res.json({ success: true, data: installment });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Update Payment Details (customFee + admission) ─────────
const updatePaymentDetails = async (req: Request, res: Response) => {
  try {
    const { enrollmentId, customFee, admissionPayment } = req.body;
    if (!enrollmentId) {
      return res.status(400).json({ success: false, message: 'enrollmentId required' });
    }

    const update: any = {};
    if (customFee !== undefined && customFee !== null) {
      update.customFee = Number(customFee);
    }
    if (admissionPayment !== undefined && admissionPayment !== null) {
      update['payment.amount'] = Number(admissionPayment);
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const enrollment = await Enrollment.findByIdAndUpdate(enrollmentId, update, { new: true });
    if (!enrollment) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    // total/admission বদলানোর পর যদি fully paid হয়ে যায় → mark paid
    await InstallmentService.markPaidIfSettled(enrollmentId);

    res.json({ success: true, data: enrollment });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Settle Full: বিদ্যমান unpaid installment paid করে + বাকি gap যোগ করে ──
const settleFull = async (req: Request, res: Response) => {
  try {
    const { enrollmentId, method } = req.body;
    if (!enrollmentId) {
      return res.status(400).json({ success: false, message: 'enrollmentId required' });
    }
    const enrollment: any = await Enrollment.findById(enrollmentId).populate('courseId', 'fee offerPrice');
    if (!enrollment) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }
    const defaultFee = parsePrice(enrollment.courseId?.offerPrice) || parsePrice(enrollment.courseId?.fee);
    const agreedTotal = Number(enrollment.customFee) || defaultFee;
    const payMethod = method || 'cash';
    const courseId = enrollment.courseId?._id || enrollment.courseId;

    // 1) সব unpaid installment paid করে দাও (নতুন duplicate না বানিয়ে)
    await Installment.updateMany(
      { enrollmentId, status: { $ne: 'paid' }, isDeleted: false },
      { $set: { status: 'paid', paidDate: new Date(), method: payMethod } },
    );

    // 2) এখনও কম পড়লে বাকি টাকার জন্য একটা paid installment যোগ করো
    const paidAgg = await Installment.aggregate([
      { $match: { enrollmentId: enrollment._id, status: 'paid', isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalPaid = (enrollment.payment?.amount || 0) + (paidAgg[0]?.total || 0);
    const gap = agreedTotal - totalPaid;
    if (gap > 0) {
      const last = await Installment.findOne({ enrollmentId }).sort({ installmentNumber: -1 }).lean();
      const nextNumber = (last?.installmentNumber || 0) + 1;
      await Installment.create({
        enrollmentId,
        studentId: enrollment.studentId,
        courseId,
        installmentNumber: nextNumber,
        amount: gap,
        dueDate: new Date(),
        paidDate: new Date(),
        status: 'paid',
        method: payMethod,
        notes: 'Full settlement',
        isDeleted: false,
      });
    }

    await InstallmentService.markPaidIfSettled(enrollmentId);
    res.json({ success: true, message: 'Fully settled' });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Delete an installment (admin) ──────────────────────────
const deleteInstallment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const inst = await Installment.findByIdAndDelete(id);
    if (!inst) {
      return res.status(404).json({ success: false, message: 'Installment not found' });
    }
    res.json({ success: true, message: 'Installment deleted' });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════════
// INCOME REPORT — the single source of truth for the Analytics page.
// INCOME = money actually received. Model A: admission (enrollment.payment.amount)
// and installments (installment.amount) are DISJOINT ledgers → they are SUMMED,
// never either/or (the old revenue endpoints wrongly dropped admissions when a
// month had any installment). IELTS = paid purchase payment.amount.
// Amounts are the RAW received figures (never course fee/offerPrice fallback).
// Dates attribute money by when it was RECEIVED (paidAt / paidDate).
// ══════════════════════════════════════════════════════════════
const getIncomeReport = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : null;
    let end: Date | null = null;
    if (endDate) { end = new Date(endDate as string); end.setHours(23, 59, 59, 999); }
    const inRange = (d: any): boolean => {
      if (!d) return false;
      const t = new Date(d).getTime();
      if (start && t < start.getTime()) return false;
      if (end && t > end.getTime()) return false;
      return true;
    };
    const mKey = (d: any) => {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    };
    const mLabel = (key: string) => {
      const [y, m] = key.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'short', year: '2-digit' });
    };
    const nameOf = (s: any) => s?.name || [s?.firstName, s?.lastName].filter(Boolean).join(' ').trim() || s?.email || 'Unknown';

    // ── Fetch received-money documents ──
    const courseCoursePop = { path: 'courseId', select: 'title type category', populate: { path: 'category', select: 'name' } };
    const [paidEnrollments, paidInstallments, paidPurchases] = await Promise.all([
      Enrollment.find({ 'payment.status': 'paid', isDeleted: false })
        .populate(courseCoursePop as any).populate('studentId', 'firstName lastName name email').lean(),
      Installment.find({ status: 'paid', isDeleted: false })
        .populate(courseCoursePop as any).populate('studentId', 'firstName lastName name email').lean(),
      // TODO(integration): ielts module not yet ported → restore when available
      // IeltsMockPurchase.find({ isDeleted: false, 'payment.status': 'paid' })
      //   .populate('studentId', 'firstName lastName name email').populate('packageId', 'title').lean(),
      Promise.resolve([] as any[]),
    ]);

    // ── Build flat COURSE transaction rows (admission + installment) ──
    const courseTx: any[] = [];
    for (const e of paidEnrollments as any[]) {
      const amount = Number(e.payment?.amount) || 0;
      const date = e.payment?.paidAt || e.createdAt;
      if (amount <= 0 || !inRange(date)) continue;               // free/zero rows carry no income
      const c = e.courseId || {};
      courseTx.push({
        date, kind: 'admission', amount, method: e.payment?.method || 'other',
        student: nameOf(e.studentId), course: c.title || 'Course',
        courseType: c.type || 'Other', category: c.category?.name || 'Uncategorized',
      });
    }
    for (const i of paidInstallments as any[]) {
      const amount = Number(i.amount) || 0;
      const date = i.paidDate || i.createdAt;
      if (amount <= 0 || !inRange(date)) continue;
      const c = i.courseId || {};
      courseTx.push({
        date, kind: 'installment', amount, method: i.method || 'other',
        student: nameOf(i.studentId), course: c.title || 'Course',
        courseType: c.type || 'Other', category: c.category?.name || 'Uncategorized',
      });
    }

    // ── Build flat IELTS transaction rows ──
    const ieltsTx: any[] = [];
    for (const p of paidPurchases as any[]) {
      const amount = Number(p.payment?.amount) || 0;
      const date = p.payment?.paidAt || p.approvedAt || p.createdAt;
      if (amount <= 0 || !inRange(date)) continue;               // free rows carry no income
      ieltsTx.push({
        date, amount, method: p.payment?.method || 'other',
        discount: Number(p.payment?.discountAmount) || 0,
        student: nameOf(p.studentId), package: p.packageId?.title || p.packageTitle || 'IELTS Mock',
        examId: p.examId, orderKey: p.bundleGroupId || String(p._id),
      });
    }

    // ── Aggregation helpers ──
    const groupSum = (arr: any[], keyFn: (x: any) => string) => {
      const m: Record<string, number> = {};
      for (const x of arr) { const k = keyFn(x); m[k] = (m[k] || 0) + x.amount; }
      return m;
    };
    const toSortedArr = (obj: Record<string, number>, key: string) =>
      Object.entries(obj).map(([k, v]) => ({ [key]: k, amount: v })).sort((a: any, b: any) => b.amount - a.amount);
    const monthSeries = (arr: any[]) => {
      const m = groupSum(arr, (x) => mKey(x.date));
      return Object.keys(m).sort().map((k) => ({ month: k, label: mLabel(k), amount: m[k] }));
    };
    const byDate = (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime();

    const courseTotal = courseTx.reduce((s, x) => s + x.amount, 0);
    const admissionTotal = courseTx.filter((x) => x.kind === 'admission').reduce((s, x) => s + x.amount, 0);
    const installmentTotal = courseTx.filter((x) => x.kind === 'installment').reduce((s, x) => s + x.amount, 0);
    const ieltsTotal = ieltsTx.reduce((s, x) => s + x.amount, 0);

    // IELTS per-package with count
    const pkgMap: Record<string, { amount: number; count: number }> = {};
    for (const x of ieltsTx) { (pkgMap[x.package] ||= { amount: 0, count: 0 }); pkgMap[x.package].amount += x.amount; pkgMap[x.package].count += 1; }
    const ieltsByPackage = Object.entries(pkgMap).map(([pkg, v]) => ({ package: pkg, amount: v.amount, count: v.count })).sort((a, b) => b.amount - a.amount);

    // Combined per-month (course + ielts) for the dual-line chart
    const cMonth = groupSum(courseTx, (x) => mKey(x.date));
    const iMonth = groupSum(ieltsTx, (x) => mKey(x.date));
    const allMonths = [...new Set([...Object.keys(cMonth), ...Object.keys(iMonth)])].sort();
    const combinedByMonth = allMonths.map((k) => ({
      month: k, label: mLabel(k), course: cMonth[k] || 0, ielts: iMonth[k] || 0, total: (cMonth[k] || 0) + (iMonth[k] || 0),
    }));

    res.json({
      success: true,
      data: {
        range: { start: start || null, end: end || null },
        course: {
          total: courseTotal, admissionTotal, installmentTotal, transactionCount: courseTx.length,
          byType: toSortedArr(groupSum(courseTx, (x) => x.courseType), 'type'),
          byCategory: toSortedArr(groupSum(courseTx, (x) => x.category), 'category'),
          byMethod: toSortedArr(groupSum(courseTx, (x) => x.method), 'method'),
          byMonth: monthSeries(courseTx),
          transactions: courseTx.sort(byDate),
        },
        ielts: {
          total: ieltsTotal, transactionCount: ieltsTx.length,
          orderCount: new Set(ieltsTx.map((x) => x.orderKey)).size,
          discountTotal: ieltsTx.reduce((s, x) => s + (x.discount || 0), 0),
          byPackage: ieltsByPackage,
          byMethod: toSortedArr(groupSum(ieltsTx, (x) => x.method), 'method'),
          byMonth: monthSeries(ieltsTx),
          transactions: ieltsTx.sort(byDate),
        },
        combined: {
          total: courseTotal + ieltsTotal,
          byMonth: combinedByMonth,
          bySource: [{ source: 'Course', amount: courseTotal }, { source: 'IELTS', amount: ieltsTotal }],
        },
      },
    });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const AnalyticsController = {
  getDashboardStats, getMonthlyDashboard, getEnrollmentTrends, getRevenueByMonth,
  getPopularCourses, getRevenueSummary, getStudentGrowth, getDailySales, getTypeDistribution,
  getBatchOverview, getBatchDetails, updateStudentStatus, addInstallment, updatePaymentDetails,
  settleFull, deleteInstallment, getIncomeReport,
};
