import express from 'express';
import { AnalyticsController } from './analytics.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

router.get('/dashboard', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getDashboardStats);
router.get('/monthly-dashboard', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getMonthlyDashboard);
router.get('/daily-sales', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getDailySales);
router.get('/type-distribution', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getTypeDistribution);
router.get('/enrollment-trends', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getEnrollmentTrends);
router.get('/revenue-by-month', authMiddleware, authorize('admin'), AnalyticsController.getRevenueByMonth);
router.get('/popular-courses', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getPopularCourses);
router.get('/revenue-summary', authMiddleware, authorize('admin'), AnalyticsController.getRevenueSummary);
router.get('/income-report', authMiddleware, authorize('admin'), AnalyticsController.getIncomeReport);
router.get('/student-growth', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getStudentGrowth);
router.get('/batch-overview', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.getBatchOverview);
router.get('/batch-details/:batchId', authMiddleware, authorize('admin', 'trainingManager', 'mentor'), AnalyticsController.getBatchDetails);
router.patch('/update-student-status', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.updateStudentStatus);
router.post('/add-installment', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.addInstallment);
router.post('/settle-full', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.settleFull);
router.delete('/installment/:id', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.deleteInstallment);
router.patch('/update-payment-details', authMiddleware, authorize('admin', 'trainingManager'), AnalyticsController.updatePaymentDetails);

export const AnalyticsRoutes = router;

