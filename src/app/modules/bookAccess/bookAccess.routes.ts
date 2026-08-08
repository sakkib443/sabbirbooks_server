import express from 'express';
import { BookAccessController } from './bookAccess.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// ─── Reader ─────────────────────────────────────────────────
router.get('/check/:bookId', authMiddleware, BookAccessController.checkAccess);
router.get('/my-scans', authMiddleware, BookAccessController.myScans);

// ─── Admin ──────────────────────────────────────────────────
// Manual grants: gift copies, damaged-book replacements, review copies.
router.post('/grant', authMiddleware, authorize('admin'), BookAccessController.grant);
router.delete(
  '/revoke/:userId/:bookId',
  authMiddleware,
  authorize('admin'),
  BookAccessController.revoke
);
router.get('/book/:bookId', authMiddleware, authorize('admin'), BookAccessController.list);

export const BookAccessRoutes = router;
