/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Request, Response } from 'express';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { CampusService } from './campus.service';

const router = express.Router();

// Campus deals carry prices and discounts, so they are the admin's and the
// Super Admin's (a manager is shown no money). Deleting a deal is the Super
// Admin's alone, as with every other delete.
const read = [authMiddleware, authorize('admin'), requireCapability('orders.read')];
const write = [authMiddleware, authorize('admin'), requireCapability('orders.write')];
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

// The phone book: every college with its seniors / students.
router.get('/contacts', ...read, wrap(() => CampusService.directory()));
router.post('/contacts', ...write, wrap((req) => CampusService.addContact(req.body)));
router.patch('/contacts/:id', ...write, wrap((req) => CampusService.updateContact(req.params.id, req.body)));
router.delete('/contacts/:id', ...write, wrap((req) => CampusService.removeContact(req.params.id)));

// The deals.
router.get('/orders', ...read, wrap((req) => CampusService.list(req.query)));
router.post('/orders', ...write, wrap((req) => CampusService.create(req.body, uid(req))));
router.patch('/orders/:id', ...write, wrap((req) => CampusService.update(req.params.id, req.body)));
router.post('/orders/:id/place', ...write, wrap((req) => CampusService.placeOrder(req.params.id, { sms: req.body?.sms === true })));
router.delete('/orders/:id', ...owner, wrap((req) => CampusService.remove(req.params.id)));

export const CampusRoutes = router;
