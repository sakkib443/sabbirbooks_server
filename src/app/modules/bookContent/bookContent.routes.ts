import express from 'express';
import rateLimit from 'express-rate-limit';
import { BookContentController } from './bookContent.controller';
import { authMiddleware, authorize, requireCapability, optionalAuth } from '../../middlewares/auth';
import { uploadFileLocal, uploadProtectedLocal } from '../../config/localUpload';

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

// ─── Public ─────────────────────────────────────────────────
// The shop's table of contents. Structure and counts only — no QR code at any
// level. See BookContentService.getOutline.
router.get('/outline/:bookIdOrSlug', BookContentController.getOutline);

// ─── Reader ─────────────────────────────────────────────────
// Login required: the printed book alone is not enough.
//
// This briefly took optionalAuth so the shop could link a stranger straight
// into a free chapter. The client withdrew that: what a QR opens is what the
// book is sold for, and a visitor who has not signed in must not reach it. The
// free sample the shop offers is the preview PDF, which is a separate file.
// optionalAuth, not authMiddleware: a chapter the shop has marked free opens
// for anyone with the printed QR, so the stranger has to reach the handler for
// it to decide. Every other chapter still refuses without a purchase.
router.get('/scan/:qrCode', scanLimiter, optionalAuth, BookContentController.scan);

// "Next topic" navigation for the reader. Access is re-checked server side, so
// a locked user cannot walk past a free chapter into paid content.
router.get('/next-topic/:topicId', authMiddleware, BookContentController.getNextTopicForReader);

// Answer figures / videos / PDFs. Every request is access-checked against the
// book the file belongs to — unlike /uploads, which express.static serves to
// anyone.
//
// No authMiddleware: an <img>/<video> tag cannot send an Authorization header,
// so the handler does its own auth, accepting the short-lived ?t= media token
// as well as a Bearer header. It refuses anonymous requests itself.
router.get('/media/:fileName', BookContentController.serveProtectedMedia);

// ─── Admin ──────────────────────────────────────────────────
//
// contentManager belongs here: this is the book's actual content — parts,
// chapters, topics, questions, answers and their media. A content manager who
// cannot touch it can barely manage content at all. The capability check sits
// after authorize(), so it can only narrow: an admin whose content.write has
// been switched off is refused too.
const admin = [authMiddleware, authorize('admin', 'contentManager', 'manager'), requireCapability('content.write')];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.
const adminDelete = [...admin, requireCapability('records.delete')];

router.get('/tree/:bookId', ...admin, BookContentController.getTree);
router.get('/stats/:bookId', ...admin, BookContentController.getStats);
router.get('/qr-sheet/:bookId', ...admin, BookContentController.getQrSheet);
router.get('/next-unanswered/:bookId', ...admin, BookContentController.getNextUnanswered);
router.get('/questions/topic/:topicId', ...admin, BookContentController.getQuestionsByTopic);

router.patch('/reorder/:level', ...admin, BookContentController.reorder);

// PDFs, images and short answer videos → the protected directory on the mounted
// volume (NOT uploads/, which is served publicly by express.static).
router.post(
  '/upload',
  ...admin,
  uploadProtectedLocal.single('file'),
  BookContentController.uploadFile
);

// Cover art, preview pages and sample PDFs → uploads/materials, which
// express.static hands to anyone. Same admin guard as /upload — only staff may
// write files — but the opposite destination, because these have to be READABLE
// by people who own nothing: the storefront, the homepage and Facebook's
// link-preview crawler all fetch them anonymously. Uploading a cover through
// /upload above is what turned it into a 401 and left the admin staring at a
// broken image.
router.post(
  '/upload-public',
  ...admin,
  uploadFileLocal.single('file'),
  BookContentController.uploadPublicFile
);

for (const level of ['part', 'chapter', 'topic', 'question'] as const) {
  router.post(`/${level}s`, ...admin, BookContentController.makeCreate(level));
  router.patch(`/${level}s/:id`, ...admin, BookContentController.makeUpdate(level));
}

// Only questions can be deleted. Parts, chapters and topics carry printed QR
// codes (topics directly, parts and chapters transitively) — deleting any of
// them would turn a real paper QR into a dead end, so the routes do not exist.
router.delete('/questions/:id', ...adminDelete, BookContentController.makeDelete('question'));

// Undo for the line above, and guarded identically. The delete is soft, so the
// document is still there — this is the only thing that lets the admin who just
// misclicked get the answer and its media back instead of retyping them.
//
// adminDelete, not admin: restoring is one half of a delete, and a role that is
// deliberately not trusted to remove a question has no business deciding which
// removed ones come back.
router.patch('/questions/:id/restore', ...adminDelete, BookContentController.restoreQuestion);

export const BookContentRoutes = router;
