import express from 'express';
import { LessonController } from './lesson.controller';
import { uploadFile, uploadVideo } from '../../config/cloudinary';
import { authMiddleware, authorize, requireCapability, optionalAuth } from '../../middlewares/auth';

const router = express.Router();

// Lessons and their materials are content. Mentors keep the access they had.
const contentWriteWithMentor = [
  authorize('admin', 'trainingManager', 'contentManager', 'mentor', 'manager'),
  requireCapability('content.write'),
];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.
const contentWriteWithMentorDelete = [...contentWriteWithMentor, requireCapability('records.delete')];
const contentWrite = [
  authorize('admin', 'trainingManager', 'contentManager', 'manager'),
  requireCapability('content.write'),
];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.
const contentWriteDelete = [...contentWrite, requireCapability('records.delete')];

// ── Public: Get lessons (limited info for non-enrolled) ─────
// optionalAuth: the list is public, the video and text only for staff, an
// enrolled student, or a lesson marked free (lessonAccess.ts).
router.get('/module/:moduleId', optionalAuth, LessonController.getLessonsByModule);
router.get('/course/:courseId', optionalAuth, LessonController.getLessonsByCourse);
router.get('/:id', optionalAuth, LessonController.getSingleLesson);

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
  ...contentWriteDelete,
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
  ...contentWriteWithMentorDelete,
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
