import express from 'express';
import { NotificationController } from './notification.controller';
import { smsStatus, smsTest, smsPreview, smsProbe } from './smsDiagnostics.controller';
import { authMiddleware, authorize , requireCapability } from '../../middlewares/auth';

const router = express.Router();

// User routes
router.get('/my', authMiddleware, NotificationController.getMyNotifications);
router.get('/unread-count', authMiddleware, NotificationController.getUnreadCount);
router.patch('/read-all', authMiddleware, NotificationController.markAllAsRead);
router.delete('/clear-all', authMiddleware, NotificationController.clearAll);
router.patch('/:id/read', authMiddleware, NotificationController.markAsRead);
router.delete('/:id', authMiddleware, NotificationController.remove);

// Admin/Mentor: Send notification
// Sending is an operational action, so it rides on training.manage rather
// than being open to any allowed role — that keeps it switchable per manager.
router.post('/send', authMiddleware, authorize('admin', 'trainingManager', 'mentor', 'manager'), requireCapability('training.manage'), NotificationController.adminSend);

// ─── SMS diagnostics (admin only) ────────────────────────────
//
// "Why is no SMS arriving?" is a question the shop owner asks, not somebody
// with a terminal on the production box — so the answer lives behind a URL.
// `staff.manage` rather than an order capability: this reads deployment
// configuration and can spend a message, which is owner territory.
const smsAdmin = [authMiddleware, authorize('admin'), requireCapability('staff.manage')];

router.get('/sms-status', ...smsAdmin, smsStatus);
router.get('/sms-preview', ...smsAdmin, smsPreview);
router.post('/sms-test', ...smsAdmin, smsTest);

// ─── TEMPORARY: the same answers, without a browser session ──
//
// Deliberately not behind authMiddleware. The gate is a token derived from
// JWT_ACCESS_SECRET, so the only person who can call it is a person who could
// already mint themselves an admin session — it widens nothing. Every failure
// answers 404, and no secret is ever in the response.
//
// This exists because SMS has been dead for days and the gateway's own words
// are the only thing that can say why, and they can only be heard from this
// container. DELETE IT the day SMS works.
router.get('/sms-probe', smsProbe);

export const NotificationRoutes = router;
