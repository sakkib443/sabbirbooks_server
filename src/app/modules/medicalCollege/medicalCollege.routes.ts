import express from 'express';
import { MedicalCollegeController } from './medicalCollege.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  createCollegeValidationSchema,
  updateCollegeValidationSchema,
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

export const MedicalCollegeRoutes = router;
