/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { BookAccessService } from './bookAccess.service';

/** GET /api/book-access/check/:bookId — does the logged-in user own this book? */
const checkAccess = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    const hasAccess = await BookAccessService.hasBookAccess(userId, req.params.bookId);
    res.status(200).json({ success: true, data: { hasAccess } });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/** GET /api/book-access/my-scans — topics this reader has unlocked. */
const myScans = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    const result = await BookAccessService.getScanHistory(userId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const grant = async (req: Request, res: Response) => {
  try {
    const result = await BookAccessService.grantAccess({
      userId: req.body.userId,
      bookId: req.body.bookId,
      grantedBy: (req as any).user?._id,
      note: req.body.note,
    });
    res.status(201).json({ success: true, message: 'Access granted', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const revoke = async (req: Request, res: Response) => {
  try {
    const result = await BookAccessService.revokeAccess(req.params.userId, req.params.bookId);
    if (!result) return res.status(404).json({ success: false, message: 'Grant not found' });
    res.status(200).json({ success: true, message: 'Access revoked', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const list = async (req: Request, res: Response) => {
  try {
    const result = await BookAccessService.listAccess(req.params.bookId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const BookAccessController = { checkAccess, myScans, grant, revoke, list };
