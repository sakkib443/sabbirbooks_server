import express from 'express';
import { EnrollmentController } from './enrollment.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// ── Student Routes ──────────────────────────────────────────
router.post(
  '/enroll',
  authMiddleware,
  authorize('student'),
  EnrollmentController.createEnrollment
);

router.get(
  '/my-enrollments',
  authMiddleware,
  authorize('student'),
  EnrollmentController.getMyEnrollments
);

router.get(
  '/check-access/:courseId',
  authMiddleware,
  EnrollmentController.checkAccess
);

// ── Payment ─────────────────────────────────────────────────
router.post(
  '/verify-payment',
  authMiddleware,
  EnrollmentController.verifyPayment
);

// ── Admin Routes ────────────────────────────────────────────
router.get(
  '/all',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  EnrollmentController.getAllEnrollments
);

router.get(
  '/course/:courseId',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  EnrollmentController.getCourseEnrollments
);

router.post(
  '/admin-enroll',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  EnrollmentController.adminEnroll
);

router.patch(
  '/cancel/:id',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  EnrollmentController.cancelEnrollment
);

router.patch(
  '/approve/:id',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  EnrollmentController.approveEnrollment
);

router.get(
  '/my-payments',
  authMiddleware,
  authorize('student'),
  EnrollmentController.getMyPayments
);

router.get(
  '/stats',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  EnrollmentController.getStats
);

// ── Admin: Transfer student to another course ───────────────
router.patch(
  '/:id/transfer',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  EnrollmentController.transferCourse
);

// ── Generic update (batchId, studentStatus, etc.) ───────────
router.patch(
  '/:id',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  EnrollmentController.updateEnrollment
);

// ── Mentor: Get my students ─────────────────────────────────
router.get(
  '/mentor-students',
  authMiddleware,
  authorize('mentor', 'admin', 'superAdmin'),
  EnrollmentController.getMentorStudents
);

// ── Admin: Soft-delete enrollment ───────────────────────────
// (order will show status 'deleted')
router.delete(
  '/enrollment/:id',
  authMiddleware,
  authorize('admin'),
  EnrollmentController.deleteEnrollment
);

// ── Admin: Hard-delete order ────────────────────────────────
// (permanently removes from DB)
router.delete(
  '/order/:id',
  authMiddleware,
  authorize('admin'),
  EnrollmentController.hardDeleteOrder
);

export const EnrollmentRoutes = router;
