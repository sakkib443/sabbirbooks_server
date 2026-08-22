import express from 'express';
import { InstallmentController } from './installment.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Installment plans are student payment records — a training operation.
const trainingWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'manager'),
  requireCapability('training.manage'),
];

// Student routes
router.get('/my', authMiddleware, InstallmentController.getMyInstallments);
router.get('/enrollment/:enrollmentId', authMiddleware, InstallmentController.getByEnrollment);
router.post('/pay-due', authMiddleware, authorize('student'), InstallmentController.payDue);
router.post('/:id/pay', authMiddleware, InstallmentController.pay);

// Admin routes
router.post('/create-plan', ...trainingWrite, InstallmentController.createPlan);
router.patch('/:id/verify', authMiddleware, authorize('admin'), requireCapability('training.manage'), InstallmentController.verify);
router.get('/all', ...trainingWrite, InstallmentController.getAll);
router.get('/stats', authMiddleware, authorize('admin'), requireCapability('analytics.read'), InstallmentController.getStats);
router.post('/mark-overdue', authMiddleware, authorize('admin'), InstallmentController.markOverdue);

export const InstallmentRoutes = router;
