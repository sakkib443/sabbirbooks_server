import express from 'express';
import { BookController } from './book.controller';
import validateRequest from '../../middlewares/validateRequest';
import { createBookValidationSchema, updateBookValidationSchema } from './book.validation';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// Public routes
router.get('/', BookController.getAllBooksController);
router.get('/:slug', BookController.getSingleBookController);

// Admin protected routes (auth + admin role; superAdmin always allowed)
router.post(
  '/',
  authMiddleware,
  authorize('admin'),
  validateRequest(createBookValidationSchema),
  BookController.createBookController
);

router.patch(
  '/:id',
  authMiddleware,
  authorize('admin'),
  validateRequest(updateBookValidationSchema),
  BookController.updateBookController
);

router.delete(
  '/:id',
  authMiddleware,
  authorize('admin'),
  BookController.deleteBookController
);

export const BookRoutes = router;
