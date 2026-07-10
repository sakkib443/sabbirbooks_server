import express from 'express';
import { CourseModuleController } from './courseModule.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// Public: Get modules by course (for course detail page curriculum)
router.get('/course/:courseId', CourseModuleController.getModulesByCourse);
router.get('/:id', CourseModuleController.getSingleModule);

// Admin/Mentor: Module CRUD
router.post(
  '/create',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  CourseModuleController.createModule
);

router.patch(
  '/:id',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  CourseModuleController.updateModule
);

router.delete(
  '/:id',
  authMiddleware,
  authorize('admin', 'trainingManager'),
  CourseModuleController.deleteModule
);

router.patch(
  '/reorder/:courseId',
  authMiddleware,
  authorize('admin', 'trainingManager', 'mentor'),
  CourseModuleController.reorderModules
);

export const ModuleRoutes = router;
