/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Request, Response } from 'express';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { LedgerService } from './ledger.service';

const router = express.Router();

// The shop's whole income and expense — the Super Admin's alone (authorize()
// with a role nobody else holds; superAdmin always passes).
const owner = [authMiddleware, authorize('superAdmin')];

const uid = (req: Request) => {
  const u: any = (req as any).user;
  return u?._id ? String(u._id) : u?.id ? String(u.id) : null;
};

const wrap = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e?.message || 'Request failed' });
  }
};

router.get('/', ...owner, wrap((req) => LedgerService.report(req.query)));
router.post('/', ...owner, wrap((req) => LedgerService.add(req.body, uid(req))));
router.patch('/:id', ...owner, wrap((req) => LedgerService.update(req.params.id, req.body)));
router.delete('/:id', ...owner, wrap((req) => LedgerService.remove(req.params.id)));

export const LedgerRoutes = router;
