import express from 'express';
import { SettingsController } from './settings.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { uploadFileLocal } from '../../config/localUpload';

const router = express.Router();

// Get site settings (public — Navbar/Footer/home read this without auth)
router.get('/', SettingsController.getSettingsController);

// Update site settings — admin / superAdmin, and only with settings.write.
// No manager role reaches this: neither is in the authorize list, and neither
// has settings.write by default. Both gates must pass.
router.patch('/', authMiddleware, authorize('admin', 'superAdmin'), requireCapability('settings.write'), SettingsController.updateSettingsController);

// Upload a new site logo (admin / superAdmin) → returns { url } to save via PATCH.
// The admin Settings page has always had the upload button; this route was
// stubbed out during the port, so the button 400'd on every click.
router.post(
  '/upload-logo',
  authMiddleware,
  authorize('admin', 'superAdmin'),
  requireCapability('settings.write'),
  uploadFileLocal.single('logo'),
  SettingsController.uploadLogoController
);

export const SettingsRoutes = router;
