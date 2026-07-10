import express from 'express';
import { CourseController } from './course.controller';
import validateRequest from '../../middlewares/validateRequest';
import { courseValidationSchema } from './course.validation';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// Public routes
router.get('/', CourseController.getAllCoursesController);
router.get('/:id', CourseController.getSingleCourseController);

// Admin/TrainingManager protected routes
router.post(
  '/create-course',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  validateRequest(courseValidationSchema),
  CourseController.createCourseController
);

router.patch(
  '/:id',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  CourseController.updateCourseController
);

router.delete(
  '/:id',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  CourseController.deleteCourseController
);

export const CourseRoutes = router;
