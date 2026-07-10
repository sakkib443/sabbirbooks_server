import express from 'express';
import { CategoryController } from './courseCategory.controller';
import validateRequest from '../../middlewares/validateRequest';
import { categoryValidationSchema } from './courseCategory.validation';
import { authMiddleware, authorize } from '../../middlewares/auth';


const router = express.Router();

// Reads are public (used on course create/details). Writes are admin-only.
router.post('/create-category', authMiddleware, authorize('admin', 'trainingManager'), validateRequest(categoryValidationSchema), CategoryController.createCategoryController);
router.get('/', CategoryController.getAllCategoriesController);
router.get('/:id', CategoryController.getSingleCategoryController);
router.patch('/:id', authMiddleware, authorize('admin', 'trainingManager'), CategoryController.updateCategoryController);
router.delete('/:id', authMiddleware, authorize('admin', 'trainingManager'), CategoryController.deleteCategoryController);

export const CategoryRoutes = router;
