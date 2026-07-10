import express from 'express';
import { QrResourceController } from './qrResource.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  createQrResourceValidationSchema,
  updateQrResourceValidationSchema,
} from './qrResource.validation';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// ─── Admin protected routes (auth + admin role; superAdmin always allowed) ────
// Registered BEFORE the public single-segment '/:slug' so the public catch-all
// never shadows the admin list ('/') or the '/admin/:id' editing lookup.
router.get('/', authMiddleware, authorize('admin'), QrResourceController.getAllQrResourcesController);

router.get(
  '/admin/:id',
  authMiddleware,
  authorize('admin'),
  QrResourceController.getQrResourceByIdController
);

router.post(
  '/',
  authMiddleware,
  authorize('admin'),
  validateRequest(createQrResourceValidationSchema),
  QrResourceController.createQrResourceController
);

router.patch(
  '/:id',
  authMiddleware,
  authorize('admin'),
  validateRequest(updateQrResourceValidationSchema),
  QrResourceController.updateQrResourceController
);

router.delete(
  '/:id',
  authMiddleware,
  authorize('admin'),
  QrResourceController.deleteQrResourceController
);

// ─── Public route (no auth) — the URL a scanned QR code opens ─────────────────
router.get('/:slug', QrResourceController.getPublicQrResourceController);

export const QrResourceRoutes = router;
