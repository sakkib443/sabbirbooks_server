import express from 'express';
import { BookController } from './book.controller';
import validateRequest from '../../middlewares/validateRequest';
import { createBookValidationSchema, updateBookValidationSchema } from './book.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// A book listing IS content, so the new content-only manager gets in — but only
// while it holds `content.write`, which an admin can switch off in the
// permission matrix. Existing roles keep exactly the access they had.
const contentWrite = [authorize('admin', 'contentManager'), requireCapability('content.write')];

// Public routes
router.get('/', BookController.getAllBooksController);
router.get('/:slug', BookController.getSingleBookController);

// Admin protected routes (auth + role; superAdmin always allowed)
router.post(
  '/',
  authMiddleware,
  ...contentWrite,
  validateRequest(createBookValidationSchema),
  BookController.createBookController
);

router.patch(
  '/:id',
  authMiddleware,
  ...contentWrite,
  validateRequest(updateBookValidationSchema),
  BookController.updateBookController
);

router.delete(
  '/:id',
  authMiddleware,
  ...contentWrite,
  BookController.deleteBookController
);

export const BookRoutes = router;
