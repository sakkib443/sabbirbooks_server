/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { EnrollmentService } from './enrollment.service';

// ─── Student: Create enrollment ─────────────────────────────
const createEnrollment = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { courseId, batchId, payment } = req.body;

    const result = await EnrollmentService.createEnrollment({
      studentId: user._id,
      courseId,
      batchId,
      payment,
    });

    res.status(201).json({
      success: true,
      message: 'Enrollment created successfully',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create enrollment',
    });
  }
};

// ─── Verify payment ─────────────────────────────────────────
const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { enrollmentId, transactionId } = req.body;
    const result = await EnrollmentService.verifyPayment(enrollmentId, transactionId);

    res.status(200).json({
      success: true,
      message: 'Payment verified & enrollment activated',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Payment verification failed',
    });
  }
};

// ─── Student: My enrollments ────────────────────────────────
const getMyEnrollments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await EnrollmentService.getStudentEnrollments(user._id);

    res.status(200).json({
      success: true,
      message: 'Enrollments retrieved',
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch enrollments',
    });
  }
};

// ─── Check course access ────────────────────────────────────
const checkAccess = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { courseId } = req.params;
    const result = await EnrollmentService.checkAccess(user._id, courseId);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Access check failed',
    });
  }
};

// ─── Admin: Get all enrollments ─────────────────────────────
const getAllEnrollments = async (req: Request, res: Response) => {
  try {
    const { status, page, limit, includeDeleted } = req.query;
    const result = await EnrollmentService.getAllEnrollments({
      status: status as string,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      includeDeleted: includeDeleted === 'true',
    });

    res.status(200).json({
      success: true,
      message: 'All enrollments retrieved',
      data: result.enrollments,
      meta: result.meta,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch enrollments',
    });
  }
};

// ─── Admin: Course enrollments ──────────────────────────────
const getCourseEnrollments = async (req: Request, res: Response) => {
  try {
    const { courseId } = req.params;
    const result = await EnrollmentService.getCourseEnrollments(courseId);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch course enrollments',
    });
  }
};

// ─── Cancel enrollment ──────────────────────────────────────
const cancelEnrollment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await EnrollmentService.cancelEnrollment(id);

    res.status(200).json({
      success: true,
      message: 'Enrollment cancelled',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to cancel enrollment',
    });
  }
};

// ─── Admin: Manual enroll ───────────────────────────────────
const adminEnroll = async (req: Request, res: Response) => {
  try {
    const { studentId, courseId, batchId } = req.body;
    const result = await EnrollmentService.adminEnroll({ studentId, courseId, batchId });

    res.status(201).json({
      success: true,
      message: 'Student enrolled manually',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to enroll student',
    });
  }
};

// ─── Enrollment stats ───────────────────────────────────────
const getStats = async (req: Request, res: Response) => {
  try {
    const result = await EnrollmentService.getStats();

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch stats',
    });
  }
};

// ─── Admin: Approve enrollment ─────────────────────────────
const approveEnrollment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await EnrollmentService.approveEnrollment(id);

    res.status(200).json({
      success: true,
      message: 'Enrollment approved & activated',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to approve enrollment',
    });
  }
};

// ─── Student: Payment history ──────────────────────────────
const getMyPayments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await EnrollmentService.getStudentPayments(user._id);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payments',
    });
  }
};

// ─── Admin: Update enrollment (generic) ────────────────────
const updateEnrollment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const allowedFields = ['batchId', 'studentStatus', 'status', 'completionPercent', 'expiresAt'];
    const updateData: Record<string, any> = {};
    const unsetData: Record<string, any> = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'batchId' && (!req.body[field] || req.body[field] === '')) {
          unsetData[field] = 1;
        } else {
          updateData[field] = req.body[field];
        }
      }
    }

    // ── Admin edit: agreed total (customFee) + payment fields ──
    // Admin এখান থেকে প্রতিটা মান ঠিক করতে পারে (ভুল তথ্য, hand cash ইত্যাদি)
    if (req.body.customFee !== undefined) {
      updateData.customFee = Number(req.body.customFee) || 0;
    }
    const pay = req.body.payment;
    if (pay && typeof pay === 'object') {
      if (pay.amount !== undefined) updateData['payment.amount'] = Number(pay.amount) || 0;
      if (pay.method !== undefined) updateData['payment.method'] = pay.method;
      if (pay.transactionId !== undefined) updateData['payment.transactionId'] = pay.transactionId;
      if (pay.status !== undefined) {
        updateData['payment.status'] = pay.status;
        if (pay.status === 'paid') updateData['payment.paidAt'] = pay.paidAt || new Date();
      }
      const gw = pay.gatewayData;
      if (gw && typeof gw === 'object') {
        if (gw.senderNumber !== undefined) updateData['payment.gatewayData.senderNumber'] = gw.senderNumber;
        if (gw.paymentType !== undefined) updateData['payment.gatewayData.paymentType'] = gw.paymentType;
        if (gw.notes !== undefined) updateData['payment.gatewayData.notes'] = gw.notes;
      }
    }

    // ── Batch-Course Validation ───────────────────────────
    // PORT: batch module not yet ported — batch-course validation disabled.
    // // If assigning a batch, verify it belongs to the same course
    // if (updateData.batchId) {
    //   const { Enrollment } = require('./enrollment.model');
    //   const { Batch } = await import('../batch/batch.model');
    //
    //   const enrollment = await Enrollment.findById(id);
    //   if (!enrollment) return res.status(404).json({ success: false, message: 'Enrollment not found' });
    //
    //   const batch = await Batch.findById(updateData.batchId);
    //   if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    //
    //   // Compare courseId
    //   const enrollCourseId = enrollment.courseId?.toString();
    //   const batchCourseId = batch.courseId?.toString();
    //
    //   if (batchCourseId && enrollCourseId && batchCourseId !== enrollCourseId) {
    //     return res.status(400).json({
    //       success: false,
    //       message: 'এই batch অন্য course-এর! Student যেই course-এ enrolled, সেই course-এর batch-ই select করুন।',
    //     });
    //   }
    // }

    const updateQuery: any = {};
    if (Object.keys(updateData).length > 0) updateQuery.$set = updateData;
    if (Object.keys(unsetData).length > 0) updateQuery.$unset = unsetData;

    const { Enrollment } = require('./enrollment.model');
    const result = await Enrollment.findByIdAndUpdate(id, updateQuery, { new: true })
      .populate('studentId', 'firstName lastName name email phone')
      .populate('courseId', 'title image type')
      .populate('batchId', 'id name courseName');

    if (!result) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Enrollment updated successfully',
      data: result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update enrollment',
    });
  }
};

// ─── Mentor: Get my students ───────────────────────────────
const getMentorStudents = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const result = await EnrollmentService.getMentorStudents(userId);
    res.status(200).json({
      success: true,
      data: result.students,
      batches: result.batches,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin: Transfer student to another course ────────────
const transferCourse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { newCourseId, newBatchId } = req.body;
    if (!newCourseId) return res.status(400).json({ success: false, message: 'newCourseId is required' });

    const result = await EnrollmentService.transferCourse(id, newCourseId, newBatchId);
    res.status(200).json({
      success: true,
      message: 'Student transferred to new course successfully',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Admin: Soft-delete enrollment ────────────────────────
const deleteEnrollment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await EnrollmentService.softDeleteEnrollment(id);

    res.status(200).json({
      success: true,
      message: 'Enrollment deleted successfully. Order status set to Deleted.',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to delete enrollment',
    });
  }
};

// ─── Admin: Hard-delete order ──────────────────────────────
const hardDeleteOrder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await EnrollmentService.hardDeleteOrder(id);

    res.status(200).json({
      success: true,
      message: 'Order deleted permanently',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to delete order',
    });
  }
};

export const EnrollmentController = {
  createEnrollment,
  verifyPayment,
  getMyEnrollments,
  checkAccess,
  getAllEnrollments,
  getCourseEnrollments,
  cancelEnrollment,
  adminEnroll,
  getStats,
  approveEnrollment,
  getMyPayments,
  updateEnrollment,
  getMentorStudents,
  transferCourse,
  deleteEnrollment,
  hardDeleteOrder,
};
