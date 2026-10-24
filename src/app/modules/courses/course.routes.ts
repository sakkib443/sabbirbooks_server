import express from 'express';
import { CourseController } from './course.controller';
import { createDemoCourse } from './demoCourse';
import validateRequest from '../../middlewares/validateRequest';
import { courseValidationSchema } from './course.validation';
import { authMiddleware, authorize, requireCapability, optionalAuth } from '../../middlewares/auth';

const router = express.Router();

// Course records are content — see book.routes.ts for the pattern.
const contentWrite = [
  authorize('admin', 'trainingManager', 'contentManager', 'manager'),
  requireCapability('content.write'),
];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.
const contentWriteDelete = [...contentWrite, requireCapability('records.delete')];

// Public routes
// optionalAuth: only staff may ask for drafts (?status=…); the public sees published.
router.get('/', optionalAuth, CourseController.getAllCoursesController);
// optionalAuth: a draft or archived course is only for staff.
router.get('/:id', optionalAuth, CourseController.getSingleCourseController);

// The ready-made demo recorded course (25 Oct 2026) — Super Admin, one button.
// Declared before '/:id'-style routes that could swallow it.
router.post('/demo-course', authMiddleware, authorize('superAdmin'), async (_req, res) => {
  try {
    const r = await createDemoCourse();
    res.status(r.created ? 201 : 200).json({ success: true, message: r.created ? 'Demo course created' : 'Demo course already exists', data: r.course });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e?.message || 'Could not create the demo course' });
  }
});

// Admin/TrainingManager protected routes
router.post(
  '/create-course',
  authMiddleware,
  ...contentWrite,
  validateRequest(courseValidationSchema),
  CourseController.createCourseController
);

router.patch(
  '/:id',
  authMiddleware,
  ...contentWrite,
  CourseController.updateCourseController
);

router.delete(
  '/:id',
  authMiddleware,
  ...contentWriteDelete,
  CourseController.deleteCourseController
);

export const CourseRoutes = router;
