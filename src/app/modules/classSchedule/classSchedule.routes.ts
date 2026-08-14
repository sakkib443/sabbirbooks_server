import express from 'express';
import { ClassScheduleController } from './classSchedule.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { uploadFileLocal } from '../../config/localUpload';

const router = express.Router();

// Class scheduling is a training operation. Role lists unchanged; mentors keep
// their access (mentor carries training.manage by default).
const trainingWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager'),
  requireCapability('training.manage'),
];
const trainingWriteWithMentor = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  requireCapability('training.manage'),
];

// ── Student routes (BEFORE /:id) ─────────────────────────
router.get('/student/schedule', authMiddleware, ClassScheduleController.studentSchedule);
router.get('/student/today', authMiddleware, ClassScheduleController.todayClasses);

// ── Mentor routes (BEFORE /:id) ──────────────────────────
router.get('/mentor/my-classes', authMiddleware, authorize('mentor'), ClassScheduleController.myClasses);

// ── File Upload (local disk — materials / recordings / PDFs) ─
router.post('/upload-material', ...trainingWriteWithMentor, uploadFileLocal.single('file'), ClassScheduleController.uploadMaterial);

// ── Admin / Training Manager routes ──────────────────────
router.post('/', ...trainingWriteWithMentor, ClassScheduleController.create);
router.get('/all', ...trainingWrite, ClassScheduleController.getAll);
router.get('/stats', ...trainingWrite, ClassScheduleController.stats);

// ── Parameterized routes (AFTER named routes) ────────────
router.get('/:id', authMiddleware, ClassScheduleController.getOne);
router.patch('/:id', ...trainingWriteWithMentor, ClassScheduleController.update);
// mentor may delete too — the controller restricts a mentor to their OWN classes
router.delete('/:id', ...trainingWriteWithMentor, ClassScheduleController.remove);

// ── Mentor actions on specific class ─────────────────────
router.patch('/:id/recording', authMiddleware, authorize('mentor', 'admin'), ClassScheduleController.uploadRecording);
router.post('/:id/recording', authMiddleware, authorize('mentor', 'admin'), ClassScheduleController.addRecording);
router.delete('/:id/recording/:index', authMiddleware, authorize('mentor', 'admin'), ClassScheduleController.removeRecording);
router.post('/:id/material', authMiddleware, authorize('mentor', 'admin'), ClassScheduleController.addMaterial);
router.delete('/:id/material/:index', authMiddleware, authorize('mentor', 'admin'), ClassScheduleController.removeMaterial);
router.patch('/:id/send-to-students', authMiddleware, authorize('mentor', 'admin'), ClassScheduleController.sendToStudents);

// ── Get classes by batch (admin/TM/mentor only; a mentor is restricted to their OWN batches in the controller) ──
router.get('/batch/:batchId', ...trainingWriteWithMentor, ClassScheduleController.getByBatch);

export const ClassScheduleRoutes = router;
