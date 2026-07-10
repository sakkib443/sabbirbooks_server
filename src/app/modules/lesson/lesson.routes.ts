import express from 'express';
import { LessonController } from './lesson.controller';
import { uploadFile, uploadVideo } from '../../config/cloudinary';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// ── Public: Get lessons (limited info for non-enrolled) ─────
router.get('/module/:moduleId', LessonController.getLessonsByModule);
router.get('/course/:courseId', LessonController.getLessonsByCourse);
router.get('/:id', LessonController.getSingleLesson);

// ── Admin/Mentor: Lesson CRUD ───────────────────────────────
router.post(
  '/create',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  LessonController.createLesson
);

router.patch(
  '/:id',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  LessonController.updateLesson
);

router.delete(
  '/:id',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  LessonController.deleteLesson
);

// ── Materials ───────────────────────────────────────────────
router.post(
  '/:id/materials',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  uploadFile.single('file'),
  LessonController.addMaterial
);

router.delete(
  '/:id/materials/:materialId',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  LessonController.removeMaterial
);

// ── Student Progress ────────────────────────────────────────
router.post(
  '/:id/progress',
  authMiddleware,
  authorize('student'),
  LessonController.updateProgress
);

router.get(
  '/progress/:courseId/:studentId',
  authMiddleware,
  LessonController.getStudentProgress
);

export const LessonRoutes = router;
