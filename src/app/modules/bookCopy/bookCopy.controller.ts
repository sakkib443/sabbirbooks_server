/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { BookCopyService } from './bookCopy.service';
import { BookCopy } from './bookCopy.model';

const uid = (req: Request) => (req as any).user?._id || (req as any).user?.id;

/**
 * How many wrong codes one account may try before it has to wait.
 *
 * The keyspace makes guessing hopeless on its own — this is here so a script
 * cannot make the attempt cheap enough to be worth writing, and so a genuine
 * reader mistyping the same code four times still gets a useful message rather
 * than a lockout. Counted per account rather than per IP: a signed-in reader
 * is the only thing that can redeem, and a whole medical college hostel shares
 * one IP.
 */
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const attempts = new Map<string, { n: number; until: number }>();

const tooManyAttempts = (userId: string): boolean => {
  const now = Date.now();
  const rec = attempts.get(userId);
  if (!rec || rec.until < now) return false;
  return rec.n >= ATTEMPT_LIMIT;
};

const noteFailure = (userId: string): void => {
  const now = Date.now();
  const rec = attempts.get(userId);
  if (!rec || rec.until < now) {
    attempts.set(userId, { n: 1, until: now + ATTEMPT_WINDOW_MS });
  } else {
    rec.n += 1;
  }
  // The map is per-process and never grows without bound: entries are dropped
  // once they expire and someone tries again. A sweep keeps a burst of failed
  // attempts from a thousand accounts from living for the window's length.
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  }
};

/**
 * POST /api/book-copies/redeem — the public-facing one.
 *
 * Signed in, because the whole point is to attach a book to an account. The
 * form the reader fills in creates that account first when they do not have
 * one, so from here it is always an authenticated request.
 */
export const redeemCode = async (req: Request, res: Response) => {
  try {
    const userId = String(uid(req) || '');
    if (!userId) return res.status(401).json({ success: false, message: 'Sign in first' });

    if (tooManyAttempts(userId)) {
      return res.status(429).json({
        success: false,
        message:
          'অনেকবার ভুল কোড দেওয়া হয়েছে। ১০ মিনিট পর আবার চেষ্টা করুন। (Too many wrong codes — try again in 10 minutes.)',
      });
    }

    const result = await BookCopyService.redeem({
      code: req.body?.code,
      userId,
      fullName: req.body?.fullName,
      medicalCollege: req.body?.medicalCollege,
      medicalCollegeName: req.body?.medicalCollegeName,
      classRoll: req.body?.classRoll,
    });

    res.json({
      success: true,
      message: `${result.bookTitle} চালু হয়েছে! এখন QR স্ক্যান করে সব উত্তর দেখতে পারবেন।`,
      data: result,
    });
  } catch (e: any) {
    noteFailure(String(uid(req) || 'anon'));
    res.status(400).json({ success: false, message: e.message });
  }
};

/**
 * GET /api/book-copies/mine — what this account has redeemed.
 *
 * So a reader can see that their code went through, and which book it opened.
 */
export const myCodes = async (req: Request, res: Response) => {
  try {
    const rows = await BookCopy.find({ redeemedBy: uid(req) })
      .populate('book', 'title slug coverImage')
      .select('code book redeemedAt holder')
      .sort({ redeemedAt: -1 })
      .lean();
    res.json({ success: true, data: rows });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Admin ───────────────────────────────────────────────────

export const generateCodes = async (req: Request, res: Response) => {
  try {
    const made = await BookCopyService.generate({
      bookId: req.body?.bookId,
      count: req.body?.count,
      batch: req.body?.batch,
      createdBy: uid(req),
    });
    res.status(201).json({
      success: true,
      message: `${made.length} codes created.`,
      data: { count: made.length, codes: made.map((c) => c.code) },
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
};

export const listCodes = async (req: Request, res: Response) => {
  try {
    const data = await BookCopyService.list(req.query as any);
    res.json({ success: true, ...data });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * GET /release — how far down the printed sheet the codes currently work.
 *
 * Read-only, and the number it leads with is `releasedUpTo` because that is
 * what the admin types back to move the line.
 */
export const releaseStatus = async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await BookCopyService.releaseState() });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * PATCH /release { upTo } — release serials 1..upTo, hold back the rest.
 *
 * The whole print run's codes exist from day one; the books ship in batches.
 * This is what keeps a code from an unprinted batch worth nothing until its
 * books are actually out.
 */
export const setRelease = async (req: Request, res: Response) => {
  try {
    const data = await BookCopyService.setReleasedUpTo(req.body?.upTo);
    res.json({
      success: true,
      message: `Codes 1–${data.releasedUpTo} are live. ${data.held} held back.`,
      data,
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
};

export const voidCode = async (req: Request, res: Response) => {
  try {
    const copy = await BookCopyService.voidCode(req.params.id, req.body?.reason);
    res.json({ success: true, message: 'Code voided.', data: copy });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
};

/**
 * PATCH /:id/reset — put a redeemed code back into circulation.
 *
 * For the everyday mistake: a reader typed their code while signed in to the
 * wrong account. The code becomes usable again and the access it granted is
 * withdrawn — but only the access THIS code granted, so a reader who also
 * bought the book keeps what they paid for.
 */
export const resetCode = async (req: Request, res: Response) => {
  try {
    const out = await BookCopyService.resetCode({
      id: req.params.id,
      reason: req.body?.reason,
      adminId: uid(req),
    });
    res.json({
      success: true,
      message: out.previousEmail
        ? `Code reset. ${out.previousEmail} no longer has the book from it.`
        : 'Code reset.',
      data: out.copy,
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
};

/**
 * PATCH /:id/transfer { email } — move a redeemed code to another account.
 *
 * One action rather than reset-then-redeem, so the code is never loose in
 * between — which matters precisely because the reason an admin is here is
 * that a code already went somewhere it should not have.
 */
export const transferCode = async (req: Request, res: Response) => {
  try {
    const out = await BookCopyService.transferCode({
      id: req.params.id,
      email: req.body?.email,
      reason: req.body?.reason,
      adminId: uid(req),
    });
    res.json({
      success: true,
      message: `Moved to ${out.toEmail}${out.fromEmail ? ` from ${out.fromEmail}` : ''}.`,
      data: out.copy,
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
};

/** The file the printer gets. */
export const exportCodes = async (req: Request, res: Response) => {
  try {
    const csv = await BookCopyService.exportCsv(req.query as any);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="book-codes.csv"');
    // The BOM is what makes Excel read this correctly.
    res.send('﻿' + csv);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
