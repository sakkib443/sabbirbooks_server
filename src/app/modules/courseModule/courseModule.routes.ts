import express from 'express';
import { CourseModuleController } from './courseModule.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Curriculum modules are content. Mentors keep the access they already had.
const contentWriteWithMentor = [
  authorize('admin', 'trainingManager', 'contentManager', 'mentor'),
  requireCapability('content.write'),
];
const contentWrite = [
  authorize('admin', 'trainingManager', 'contentManager'),
  requireCapability('content.write'),
];

// Public: Get modules by course (for course detail page curriculum)
router.get('/course/:courseId', CourseModuleController.getModulesByCourse);
router.get('/:id', CourseModuleController.getSingleModule);

// Admin/Mentor: Module CRUD
router.post(
  '/create',
  authMiddleware,
  ...contentWriteWithMentor,
  CourseModuleController.createModule
);

router.patch(
  '/:id',
  authMiddleware,
  ...contentWriteWithMentor,
  CourseModuleController.updateModule
);

router.delete(
  '/:id',
  authMiddleware,
  ...contentWrite,
  CourseModuleController.deleteModule
);

router.patch(
  '/reorder/:courseId',
  authMiddleware,
  ...contentWriteWithMentor,
  CourseModuleController.reorderModules
);

export const ModuleRoutes = router;
