import express from 'express';
import { BookController } from './book.controller';
import validateRequest from '../../middlewares/validateRequest';
import { createBookValidationSchema, updateBookValidationSchema } from './book.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// A book listing IS content, so the new content-only manager gets in — but only
// while it holds `content.write`, which an admin can switch off in the
// permission matrix. Existing roles keep exactly the access they had.
const contentWrite = [authorize('admin', 'contentManager', 'manager'), requireCapability('content.write')];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.

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

// Deleting a book takes its orders' titles, its QR content and its codes with
// it — the Super Admin's alone (18 Oct 2026), whatever an admin or manager holds.
router.delete(
  '/:id',
  authMiddleware,
  authorize('superAdmin'),
  BookController.deleteBookController
);

export const BookRoutes = router;
