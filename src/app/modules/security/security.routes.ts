/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Super Admin's Security screen: device requests, and every staff
 * account's signed-in devices. Super Admin only — and not while viewing as
 * another role, since authorize() then sees that role.
 */
import { Router, Request, Response } from 'express';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { SecurityService } from './security.service';

const router = Router();
const owner = [authMiddleware, authorize('superAdmin')];

const send = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.status(200).json({ success: true, data: await fn(req) });
  } catch (error: any) {
    res.status(error?.status || 400).json({ success: false, message: error?.message || 'Failed' });
  }
};

router.get('/overview', ...owner, send(() => SecurityService.overview()));

router.post(
  '/requests/:id/approve',
  ...owner,
  send((req) => SecurityService.decide(String(req.params.id), 'approved', (req as any).user?._id))
);
router.post(
  '/requests/:id/reject',
  ...owner,
  send((req) => SecurityService.decide(String(req.params.id), 'rejected', (req as any).user?._id))
);

router.post(
  '/users/:userId/devices/remove',
  ...owner,
  send(async (req) => {
    const deviceId = String(req.body?.deviceId || '');
    if (!deviceId) throw Object.assign(new Error('deviceId is required'), { status: 400 });
    // The Super Admin removing the device they are using right now would sign
    // themselves out mid-click; that is what "Log out" is for.
    if (String(req.params.userId) === String((req as any).user?._id) && deviceId === (req as any).user?.did) {
      throw Object.assign(new Error('This is the device you are using now.'), { status: 400 });
    }
    return SecurityService.removeDevice(String(req.params.userId), deviceId);
  })
);
router.post(
  '/users/:userId/devices/remove-all',
  ...owner,
  send(async (req) => {
    if (String(req.params.userId) === String((req as any).user?._id)) {
      throw Object.assign(new Error('Use "remove" on each of your other devices instead.'), { status: 400 });
    }
    return SecurityService.removeAll(String(req.params.userId));
  })
);

export const SecurityRoutes = router;
