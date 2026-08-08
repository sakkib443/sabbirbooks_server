import express from 'express';
import rateLimit from 'express-rate-limit';
import { BookContentController } from './bookContent.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// The scan endpoint is the one route an unauthenticated stranger can reach with
// a guessed code. Codes are random 8-char (32^8), so a brute force is hopeless,
// but the limiter keeps it from being worth trying.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many scans, please wait a moment' },
});

// ─── Reader ─────────────────────────────────────────────────
// Login required: the printed book alone is not enough.
router.get('/scan/:qrCode', scanLimiter, authMiddleware, BookContentController.scan);

// ─── Admin ──────────────────────────────────────────────────
const admin = [authMiddleware, authorize('admin')];

router.get('/tree/:bookId', ...admin, BookContentController.getTree);
router.get('/stats/:bookId', ...admin, BookContentController.getStats);
router.get('/qr-sheet/:bookId', ...admin, BookContentController.getQrSheet);
router.get('/next-unanswered/:bookId', ...admin, BookContentController.getNextUnanswered);
router.get('/questions/topic/:topicId', ...admin, BookContentController.getQuestionsByTopic);

router.patch('/reorder/:level', ...admin, BookContentController.reorder);

for (const level of ['part', 'chapter', 'topic', 'question'] as const) {
  router.post(`/${level}s`, ...admin, BookContentController.makeCreate(level));
  router.patch(`/${level}s/:id`, ...admin, BookContentController.makeUpdate(level));
  router.delete(`/${level}s/:id`, ...admin, BookContentController.makeDelete(level));
}

export const BookContentRoutes = router;
