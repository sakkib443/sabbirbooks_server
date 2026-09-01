import express from 'express';
import { AmbassadorController } from './ambassador.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  applyValidationSchema,
  reviewValidationSchema,
  noteValidationSchema,
} from './ambassador.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { uploadProtectedLocal } from '../../config/localUpload';

const router = express.Router();

// ─── Public ─────────────────────────────────────────────────
// The application form is filled in by a student who has no account yet — that
// is the point of it — so both of these are open. Nothing they accept is
// trusted: the coupon's discount and payout are constants in the service, the
// status is forced to 'pending', and the uploaded file lands in the protected
// directory, which express.static does not serve.
router.post('/apply', validateRequest(applyValidationSchema), AmbassadorController.apply);
router.post('/id-card', uploadProtectedLocal.single('file'), AmbassadorController.uploadIdCard);

// ─── The ambassador's own ───────────────────────────────────
// Reading an ID card back is NOT public: staff, or the ambassador it belongs to.
router.get('/id-card/:fileName', authMiddleware, AmbassadorController.serveIdCard);
router.get('/me', authMiddleware, AmbassadorController.getMine);

// ─── Admin ──────────────────────────────────────────────────
// An application is a record about a person — their college, their phone, a
// photo of their ID — so it sits behind the capability that governs user
// records, not the content one.
const staff = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'manager'),
  requireCapability('users.read'),
];

router.get('/', ...staff, AmbassadorController.list);
router.get('/:id', ...staff, AmbassadorController.getById);

// Approving mints a coupon and a login; rejecting takes the coupon offline.
// That is a change to what the shop owes people, so it needs users.write on top
// of the read capability above — a reviewer who may only look cannot approve.
const reviewer = [...staff, requireCapability('users.write')];

router.patch(
  '/:id/status',
  ...reviewer,
  validateRequest(reviewValidationSchema),
  AmbassadorController.review
);
// Adding, editing and removing an affiliate all change what the shop owes
// people, so they sit behind users.write like the review actions do.
router.post('/', ...reviewer, AmbassadorController.create);
router.patch('/:id', ...reviewer, AmbassadorController.update);
router.delete('/:id', ...reviewer, requireCapability('records.delete'), AmbassadorController.remove);

router.patch(
  '/:id/note',
  ...reviewer,
  validateRequest(noteValidationSchema),
  AmbassadorController.setNote
);

export const AmbassadorRoutes = router;
