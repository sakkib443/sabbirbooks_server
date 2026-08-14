import express from 'express';
import { LessonController } from './lesson.controller';
import { uploadFile, uploadVideo } from '../../config/cloudinary';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Lessons and their materials are content. Mentors keep the access they had.
const contentWriteWithMentor = [
  authorize('admin', 'trainingManager', 'contentManager', 'mentor'),
  requireCapability('content.write'),
];
const contentWrite = [
  authorize('admin', 'trainingManager', 'contentManager'),
  requireCapability('content.write'),
];

// ── Public: Get lessons (limited info for non-enrolled) ─────
router.get('/module/:moduleId', LessonController.getLessonsByModule);
router.get('/course/:courseId', LessonController.getLessonsByCourse);
router.get('/:id', LessonController.getSingleLesson);

// ── Admin/Mentor: Lesson CRUD ───────────────────────────────
router.post(
  '/create',
  authMiddleware,
  ...contentWriteWithMentor,
  LessonController.createLesson
);

router.patch(
  '/:id',
  authMiddleware,
  ...contentWriteWithMentor,
  LessonController.updateLesson
);

router.delete(
  '/:id',
  authMiddleware,
  ...contentWrite,
  LessonController.deleteLesson
);

// ── Materials ───────────────────────────────────────────────
router.post(
  '/:id/materials',
  authMiddleware,
  ...contentWriteWithMentor,
  uploadFile.single('file'),
  LessonController.addMaterial
);

router.delete(
  '/:id/materials/:materialId',
  authMiddleware,
  ...contentWriteWithMentor,
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
