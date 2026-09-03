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

/**
 * GET /api/book-access/report — the admin's "who can read this book" screen.
 *
 * Every grant, with how it was come by and whether it lines up with an order on
 * the same account. See the service note for why the order column is the
 * interesting one.
 */
const report = async (req: Request, res: Response) => {
  try {
    const data = await BookAccessService.accessReport(req.query as any);
    res.status(200).json({ success: true, ...data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/book-access/waiting — parcels delivered, codes not yet redeemed.
 *
 * The gap this design deliberately creates. Most of these people simply have
 * not noticed the code inside the book; the shop needs to see them, and to be
 * able to hand access over when one of them rings up.
 */
const waiting = async (req: Request, res: Response) => {
  try {
    const data = await BookAccessService.waitingForCode(req.query.book as string);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/book-access/:id — block or restore one grant.
 *
 * Blocking is a soft revoke: the row stays, stamped with when. A deleted row
 * would lose the fact that this person once had access and it was taken away,
 * which is exactly the thing somebody will ask about later. Restoring clears
 * the stamp; the same person gets the same grant back rather than a new one.
 */
const setActive = async (req: Request, res: Response) => {
  try {
    const { BookAccess } = await import('./bookAccess.model');
    const active = req.body?.active !== false;
    const grantRow = await BookAccess.findByIdAndUpdate(
      req.params.id,
      active
        ? { $unset: { revokedAt: '' }, $set: { note: req.body?.note ?? undefined } }
        : { $set: { revokedAt: new Date(), note: req.body?.note ?? undefined } },
      { new: true }
    );
    if (!grantRow) return res.status(404).json({ success: false, message: 'Grant not found' });
    res.status(200).json({
      success: true,
      message: active ? 'Access restored' : 'Access blocked',
      data: grantRow,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/book-access/grant-by-email — give somebody access by hand.
 *
 * By email rather than by user id, because the admin is looking at a support
 * message, not at a database. An email with no account is refused plainly
 * rather than silently creating one: an account made here would have no
 * password and nobody could sign into it.
 */
const grantByEmail = async (req: Request, res: Response) => {
  try {
    const { User } = await import('../user/user.model');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await User.findOne({ email }).select('_id email').lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: `${email} দিয়ে কোনো অ্যাকাউন্ট নেই। আগে তাকে সাইন আপ করতে বলুন। (No account with that email — ask them to sign up first.)`,
      });
    }
    const result = await BookAccessService.grantAccess({
      userId: String((user as any)._id),
      bookId: req.body?.bookId,
      grantedBy: (req as any).user?._id,
      note: req.body?.note || 'Granted by admin',
    });
    res.status(201).json({ success: true, message: `${email} এখন বইটি পড়তে পারবে।`, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const BookAccessController = {
  checkAccess,
  myScans,
  grant,
  revoke,
  list,
  report,
  waiting,
  setActive,
  grantByEmail,
};
