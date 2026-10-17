import express from 'express';
import { AnalyticsController } from './analytics.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Every analytics endpoint answers "how much sold / how many students / how much
// money" — exactly the business data a content-only manager must never see.
// The existing role gates are kept untouched and `analytics.read` is composed on
// top, so the revenue endpoints stay admin-only AND become togglable.
const analytics = requireCapability('analytics.read');
// 17 Oct 2026: the revenue endpoints are the Super Admin's alone — an admin
// sees no money anywhere (see order/managerScope isMoneyBlind).

router.get('/dashboard', authMiddleware, authorize('admin', 'trainingManager', 'manager'), analytics, AnalyticsController.getDashboardStats);
router.get('/monthly-dashboard', authMiddleware, authorize('superAdmin'), AnalyticsController.getMonthlyDashboard);
router.get('/daily-sales', authMiddleware, authorize('admin', 'trainingManager', 'manager'), analytics, AnalyticsController.getDailySales);
router.get('/type-distribution', authMiddleware, authorize('admin', 'trainingManager', 'manager'), analytics, AnalyticsController.getTypeDistribution);
router.get('/enrollment-trends', authMiddleware, authorize('admin', 'trainingManager', 'manager'), analytics, AnalyticsController.getEnrollmentTrends);
router.get('/revenue-by-month', authMiddleware, authorize('superAdmin'), AnalyticsController.getRevenueByMonth);
router.get('/popular-courses', authMiddleware, authorize('admin', 'trainingManager', 'manager'), analytics, AnalyticsController.getPopularCourses);
router.get('/revenue-summary', authMiddleware, authorize('superAdmin'), AnalyticsController.getRevenueSummary);
router.get('/income-report', authMiddleware, authorize('superAdmin'), AnalyticsController.getIncomeReport);
router.get('/student-growth', authMiddleware, authorize('admin', 'trainingManager', 'manager'), analytics, AnalyticsController.getStudentGrowth);
router.get('/batch-overview', authMiddleware, authorize('admin', 'trainingManager', 'manager'), analytics, AnalyticsController.getBatchOverview);
router.get('/batch-details/:batchId', authMiddleware, authorize('superAdmin'), AnalyticsController.getBatchDetails);

// Writes below touch student payment records — training operations, not reporting.
router.patch('/update-student-status', authMiddleware, authorize('admin', 'trainingManager', 'manager'), requireCapability('training.manage'), AnalyticsController.updateStudentStatus);
router.post('/add-installment', authMiddleware, authorize('admin', 'trainingManager', 'manager'), requireCapability('training.manage'), AnalyticsController.addInstallment);
router.post('/settle-full', authMiddleware, authorize('admin', 'trainingManager', 'manager'), requireCapability('training.manage'), AnalyticsController.settleFull);
router.delete('/installment/:id', authMiddleware, authorize('admin', 'trainingManager', 'manager'), requireCapability('training.manage'), requireCapability('records.delete'), AnalyticsController.deleteInstallment);
router.patch('/update-payment-details', authMiddleware, authorize('admin', 'trainingManager', 'manager'), requireCapability('training.manage'), AnalyticsController.updatePaymentDetails);

export const AnalyticsRoutes = router;
