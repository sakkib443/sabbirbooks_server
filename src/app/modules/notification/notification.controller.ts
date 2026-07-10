/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { NotificationService } from './notification.service';
import { User } from '../user/user.model';

// ─── Get My Notifications ───────────────────────────────────
const getMyNotifications = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await NotificationService.getUserNotifications(user._id, page, limit);
    res.json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ─── Get Unread Count ───────────────────────────────────────
const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const count = await NotificationService.getUnreadCount(user._id);
    res.json({ success: true, data: { unread: count } });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ─── Mark As Read ───────────────────────────────────────────
const markAsRead = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await NotificationService.markAsRead(req.params.id, user._id);
    res.json({ success: true, message: 'Marked as read' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ─── Mark All As Read ───────────────────────────────────────
const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await NotificationService.markAllAsRead(user._id);
    res.json({ success: true, message: 'All marked as read' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ─── Delete One ─────────────────────────────────────────────
const remove = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await NotificationService.remove(req.params.id, user._id);
    res.json({ success: true, message: 'Deleted' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ─── Clear All ──────────────────────────────────────────────
const clearAll = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await NotificationService.clearAll(user._id);
    res.json({ success: true, message: 'All cleared' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ─── Admin: Send Notification to User(s) ────────────────────
const adminSend = async (req: Request, res: Response) => {
  try {
    const { userIds, role, title, message, type } = req.body;

    let targetIds = userIds || [];
    if (role && !userIds) {
      const users = await User.find({ role }).select('_id');
      targetIds = users.map(u => u._id.toString());
    }

    if (targetIds.length === 0) return res.status(400).json({ success: false, message: 'No target users' });

    await NotificationService.createBulk(targetIds, type || 'system', title, message);
    res.json({ success: true, message: `Sent to ${targetIds.length} users` });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

export const NotificationController = {
  getMyNotifications, getUnreadCount,
  markAsRead, markAllAsRead, remove, clearAll,
  adminSend,
};
