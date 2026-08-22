import express from 'express';
import { NotificationController } from './notification.controller';
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

export const NotificationRoutes = router;
