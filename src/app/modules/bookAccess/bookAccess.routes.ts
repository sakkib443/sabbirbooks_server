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

// ─── The access screen ──────────────────────────────────────
//
// Reading who can open a book is orders.read — it is the fulfilment question,
// "did what we sold reach who we sold it to". Changing it is orders.write:
// blocking somebody takes away something they paid for, and granting gives
// away something the shop sells, so both are the same weight as editing an
// order. Declared before '/book/:bookId' would not matter (different paths),
// but they are grouped so the screen's endpoints read together.
const read = [authMiddleware, authorize('admin', 'manager'), requireCapability('orders.read')];
const write = [authMiddleware, authorize('admin', 'manager'), requireCapability('orders.write')];

router.get('/report', ...read, BookAccessController.report);
router.get('/waiting', ...read, BookAccessController.waiting);
router.patch('/:id/active', ...write, BookAccessController.setActive);
router.post('/grant-by-email', ...write, BookAccessController.grantByEmail);

export const BookAccessRoutes = router;
