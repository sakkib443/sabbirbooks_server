import express from 'express';
import { AttendanceController } from './attendance.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Attendance is course delivery → `training.manage`. See assignment.routes.ts.

// Take/Update attendance
router.post('/', authMiddleware, authorize('mentor', 'admin'), requireCapability('training.manage'), AttendanceController.takeAttendance);

// ── Student: my own attendance (self-scoped) — before param routes ──
router.get('/my', authMiddleware, AttendanceController.getMyAttendance);
router.get('/my/summary', authMiddleware, AttendanceController.getMySummary);
router.get('/my-summary', authMiddleware, AttendanceController.getMyBatchSummary);

// Get attendance by batch + date (staff only — students use /my* endpoints for their own records)
router.get('/', authMiddleware, authorize('mentor', 'admin', 'trainingManager', 'manager'), requireCapability('training.manage'), AttendanceController.getByDate);

// Get attendance history for a batch (staff only)
router.get('/history/:batchId', authMiddleware, authorize('mentor', 'admin', 'trainingManager', 'manager'), requireCapability('training.manage'), AttendanceController.getHistory);

// Get attendance stats for a batch (staff only)
router.get('/stats/:batchId', authMiddleware, authorize('mentor', 'admin', 'trainingManager', 'manager'), requireCapability('training.manage'), AttendanceController.getStats);

// Delete attendance
router.delete('/:id', authMiddleware, authorize('mentor', 'admin', 'trainingManager', 'manager'), requireCapability('training.manage'), requireCapability('records.delete'), AttendanceController.deleteAttendance);

export const AttendanceRoutes = router;
