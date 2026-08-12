import express from 'express';
import { SettingsController } from './settings.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { uploadFileLocal } from '../../config/localUpload';

const router = express.Router();

// Get site settings (public — Navbar/Footer/home read this without auth)
router.get('/', SettingsController.getSettingsController);

// Update site settings (admin / superAdmin only — NOT trainingManager)
router.patch('/', authMiddleware, authorize('admin', 'superAdmin'), SettingsController.updateSettingsController);

// Upload a new site logo (admin / superAdmin) → returns { url } to save via PATCH.
// The admin Settings page has always had the upload button; this route was
// stubbed out during the port, so the button 400'd on every click.
router.post(
  '/upload-logo',
  authMiddleware,
  authorize('admin', 'superAdmin'),
  uploadFileLocal.single('logo'),
  SettingsController.uploadLogoController
);

export const SettingsRoutes = router;
