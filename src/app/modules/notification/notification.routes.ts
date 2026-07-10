import express from 'express';
import { NotificationController } from './notification.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// User routes
router.get('/my', authMiddleware, NotificationController.getMyNotifications);
router.get('/unread-count', authMiddleware, NotificationController.getUnreadCount);
router.patch('/read-all', authMiddleware, NotificationController.markAllAsRead);
router.delete('/clear-all', authMiddleware, NotificationController.clearAll);
router.patch('/:id/read', authMiddleware, NotificationController.markAsRead);
router.delete('/:id', authMiddleware, NotificationController.remove);

// Admin/Mentor: Send notification
router.post('/send', authMiddleware, authorize('admin', 'trainingManager', 'mentor'), NotificationController.adminSend);

export const NotificationRoutes = router;
