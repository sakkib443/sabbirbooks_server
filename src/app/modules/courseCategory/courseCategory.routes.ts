import express from 'express';
import { CategoryController } from './courseCategory.controller';
import validateRequest from '../../middlewares/validateRequest';
import { categoryValidationSchema } from './courseCategory.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';


const router = express.Router();

// Categories are content — see book.routes.ts for the pattern.
const contentWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'contentManager'),
  requireCapability('content.write'),
];

// Reads are public (used on course create/details). Writes need content.write.
router.post('/create-category', ...contentWrite, validateRequest(categoryValidationSchema), CategoryController.createCategoryController);
router.get('/', CategoryController.getAllCategoriesController);
router.get('/:id', CategoryController.getSingleCategoryController);
router.patch('/:id', ...contentWrite, CategoryController.updateCategoryController);
router.delete('/:id', ...contentWrite, CategoryController.deleteCategoryController);

export const CategoryRoutes = router;
