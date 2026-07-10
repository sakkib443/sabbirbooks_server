import express from 'express';
import { InstallmentController } from './installment.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// Student routes
router.get('/my', authMiddleware, InstallmentController.getMyInstallments);
router.get('/enrollment/:enrollmentId', authMiddleware, InstallmentController.getByEnrollment);
router.post('/pay-due', authMiddleware, authorize('student'), InstallmentController.payDue);
router.post('/:id/pay', authMiddleware, InstallmentController.pay);

// Admin routes
router.post('/create-plan', authMiddleware, authorize('admin', 'trainingManager'), InstallmentController.createPlan);
router.patch('/:id/verify', authMiddleware, authorize('admin'), InstallmentController.verify);
router.get('/all', authMiddleware, authorize('admin', 'trainingManager'), InstallmentController.getAll);
router.get('/stats', authMiddleware, authorize('admin'), InstallmentController.getStats);
router.post('/mark-overdue', authMiddleware, authorize('admin'), InstallmentController.markOverdue);

export const InstallmentRoutes = router;
