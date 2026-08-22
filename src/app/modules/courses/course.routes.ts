import express from 'express';
import { CourseController } from './course.controller';
import validateRequest from '../../middlewares/validateRequest';
import { courseValidationSchema } from './course.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

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
router.get('/', CourseController.getAllCoursesController);
router.get('/:id', CourseController.getSingleCourseController);

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
