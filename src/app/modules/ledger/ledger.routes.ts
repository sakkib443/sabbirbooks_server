/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Request, Response } from 'express';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { LedgerService, Viewer } from './ledger.service';

const router = express.Router();

// The Super Admin sees the shop's whole income and expense and their own
// personal book; an admin writes and sees only their own shop entries (23 Oct
// 2026) — ledger.service decides what each may see. Deleting is the Super
// Admin's alone.
const staff = [authMiddleware, authorize('admin')];
const owner = [authMiddleware, authorize('superAdmin')];

const viewerOf = (req: Request): Viewer => {
  const u: any = (req as any).user;
  return { id: u?._id ? String(u._id) : u?.id ? String(u.id) : null, role: String(u?.role || '') };
};

const wrap = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e?.message || 'Request failed' });
  }
};

router.get('/', ...staff, wrap((req) => LedgerService.report(req.query, viewerOf(req))));
router.post('/', ...staff, wrap((req) => LedgerService.add(req.body, viewerOf(req))));
router.patch('/:id', ...staff, wrap((req) => LedgerService.update(req.params.id, req.body, viewerOf(req))));
router.delete('/:id', ...owner, wrap((req) => LedgerService.remove(req.params.id)));

export const LedgerRoutes = router;
