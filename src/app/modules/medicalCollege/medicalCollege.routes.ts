import express from 'express';
import { MedicalCollegeController } from './medicalCollege.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  createCollegeValidationSchema,
  updateCollegeValidationSchema,
  updateCollegeDeliveryValidationSchema,
} from './medicalCollege.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// ─── Public ─────────────────────────────────────────────────
// The signup form needs the list before the visitor has an account, so these
// two carry no auth. They expose nothing but the published college directory.
router.get('/', MedicalCollegeController.list);
router.get('/regions', MedicalCollegeController.regions);

// ─── Admin ──────────────────────────────────────────────────
// The college directory is reference data about people's institutions, so it
// sits with the same capability that governs user records rather than with
// site content.
const admin = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'contentManager', 'manager'),
  requireCapability('users.write'),
];

// Declared before '/:id'-shaped routes so the literal path wins.
router.get('/all', ...admin, MedicalCollegeController.listAll);

router.post(
  '/',
  ...admin,
  validateRequest(createCollegeValidationSchema),
  MedicalCollegeController.create
);

router.patch(
  '/:id',
  ...admin,
  validateRequest(updateCollegeValidationSchema),
  MedicalCollegeController.update
);

// Retire rather than delete — see the service for why.
router.delete('/:id', ...admin, MedicalCollegeController.deactivate);

// ─── Delivery charges ───────────────────────────────────────
// A college's delivery rate changes what buyers pay, so it sits behind the
// same gate as the shop's other prices (settings.write), not behind the
// directory gate above, which a manager holds.
const pricing = [authMiddleware, authorize('admin'), requireCapability('settings.write')];

router.get('/delivery', ...pricing, MedicalCollegeController.listForDelivery);
router.patch(
  '/:id/delivery',
  ...pricing,
  validateRequest(updateCollegeDeliveryValidationSchema),
  MedicalCollegeController.setDelivery
);

export const MedicalCollegeRoutes = router;
