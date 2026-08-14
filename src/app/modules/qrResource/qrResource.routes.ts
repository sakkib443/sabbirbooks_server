import express from 'express';
import { QrResourceController } from './qrResource.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  createQrResourceValidationSchema,
  updateQrResourceValidationSchema,
} from './qrResource.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// QR resources are content — see book.routes.ts for the pattern.
const contentWrite = [authorize('admin', 'contentManager'), requireCapability('content.write')];

// ─── Admin protected routes (auth + admin role; superAdmin always allowed) ────
// Registered BEFORE the public single-segment '/:slug' so the public catch-all
// never shadows the admin list ('/') or the '/admin/:id' editing lookup.
router.get('/', authMiddleware, ...contentWrite, QrResourceController.getAllQrResourcesController);

router.get(
  '/admin/:id',
  authMiddleware,
  ...contentWrite,
  QrResourceController.getQrResourceByIdController
);

router.post(
  '/',
  authMiddleware,
  ...contentWrite,
  validateRequest(createQrResourceValidationSchema),
  QrResourceController.createQrResourceController
);

router.patch(
  '/:id',
  authMiddleware,
  ...contentWrite,
  validateRequest(updateQrResourceValidationSchema),
  QrResourceController.updateQrResourceController
);

router.delete(
  '/:id',
  authMiddleware,
  ...contentWrite,
  QrResourceController.deleteQrResourceController
);

// ─── Public route (no auth) — the URL a scanned QR code opens ─────────────────
router.get('/:slug', QrResourceController.getPublicQrResourceController);

export const QrResourceRoutes = router;
