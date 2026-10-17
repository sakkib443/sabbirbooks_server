import express, { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { BookContentController } from './bookContent.controller';
import { authMiddleware, authorize, requireCapability, optionalAuth } from '../../middlewares/auth';
import { uploadFileLocal, uploadProtectedLocal } from '../../config/localUpload';
import { clientIpKey } from '../../utils/clientIp';

const router = express.Router();

// The scan endpoint is the one route an unauthenticated stranger can reach with
// a guessed code. Codes are random 8-char (32^8), so a brute force is hopeless,
// but the limiter keeps it from being worth trying.
//
// A signed-in reader is counted as themselves, by account: that is nearly every
// scan, and a whole class scanning the same page at once must never share one
// allowance. A stranger is counted by their own address (utils/clientIp) — not
// by req.ip, which is our Next proxy and was the same for every visitor, so the
// entire site used to get thirty scans a minute between all of its readers.
// The stranger's allowance is the larger one because mobile networks here put
// many phones behind one address. optionalAuth runs first so req.user is known;
// it is set only for a token that verified, so a forged header buys nothing.
const readerId = (req: Request): string | undefined =>
  (req as Request & { user?: { _id?: string } }).user?._id;

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req) => (readerId(req) ? 60 : 120),
  keyGenerator: (req) => {
    const userId = readerId(req);
    return userId ? `user:${userId}` : `ip:${clientIpKey(req)}`;
  },
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
router.get('/scan/:qrCode', optionalAuth, scanLimiter, BookContentController.scan);

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

// "Download all" for a topic: every PDF in its questions as one file. The
// first call gets it ready (and builds it once, for everyone after); the link
// it returns is fetched by the phone's download manager, which cannot send a
// header — so, like /media, the file route takes the ?t= media token and does
// its own access check, file by file.
router.get('/topic-pdfs/:topicId', optionalAuth, BookContentController.prepareTopicPdfs);
router.get('/topic-pdfs/:topicId/file', BookContentController.serveTopicPdfs);

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
// Messages this book already uses where a video is missing, so the editor can
// offer them back instead of making the admin retype one. See getVideoNotes.
router.get('/video-notes/:bookId', ...admin, BookContentController.getVideoNotes);

router.patch('/reorder/:level', ...admin, BookContentController.reorder);

// The "video unavailable" notice, on or off for many questions at once.
router.patch('/video-note-visibility', ...admin, BookContentController.setVideoNoteVisibility);

// Saved messages for where a video is missing — written once, put anywhere.
router.get('/video-note-presets', ...admin, BookContentController.listVideoNotePresets);
router.post('/video-note-presets', ...admin, BookContentController.addVideoNotePreset);
router.delete('/video-note-presets/:id', ...admin, BookContentController.removeVideoNotePreset);

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
