import express from 'express';
import { BookAccessController } from './bookAccess.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// ─── Reader ─────────────────────────────────────────────────
router.get('/check/:bookId', authMiddleware, BookAccessController.checkAccess);
router.get('/my-scans', authMiddleware, BookAccessController.myScans);

// ─── Admin ──────────────────────────────────────────────────
// Who holds a copy of a book is the fulfilment side of an order, so these map
// onto the order capabilities rather than the content ones: listing tells you
// who bought, granting is an order action.
router.post('/grant', authMiddleware, authorize('admin'), requireCapability('orders.write'), BookAccessController.grant);
router.delete(
  '/revoke/:userId/:bookId',
  authMiddleware,
  authorize('admin'),
  requireCapability('orders.write'),
  BookAccessController.revoke
);
router.get('/book/:bookId', authMiddleware, authorize('admin'), requireCapability('orders.read'), BookAccessController.list);

export const BookAccessRoutes = router;
