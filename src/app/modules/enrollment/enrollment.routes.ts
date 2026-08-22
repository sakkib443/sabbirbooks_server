import express from 'express';
import { EnrollmentController } from './enrollment.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Enrollments carry who joined which course and what they paid. The role list is
// unchanged; `training.manage` is added so an admin can revoke it in the matrix.
// A contentManager is in neither list and therefore never sees any of it.
const trainingWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'manager'),
  requireCapability('training.manage'),
];

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
  ...trainingWrite,
  EnrollmentController.getAllEnrollments
);

router.get(
  '/course/:courseId',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor', 'manager'),
  requireCapability('training.manage'),
  EnrollmentController.getCourseEnrollments
);

router.post(
  '/admin-enroll',
  ...trainingWrite,
  EnrollmentController.adminEnroll
);

router.patch(
  '/cancel/:id',
  ...trainingWrite,
  EnrollmentController.cancelEnrollment
);

router.patch(
  '/approve/:id',
  ...trainingWrite,
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
  ...trainingWrite,
  EnrollmentController.getStats
);

// ── Admin: Transfer student to another course ───────────────
router.patch(
  '/:id/transfer',
  ...trainingWrite,
  EnrollmentController.transferCourse
);

// ── Generic update (batchId, studentStatus, etc.) ───────────
router.patch(
  '/:id',
  ...trainingWrite,
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
