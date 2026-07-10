import express from 'express';
import { SettingsController } from './settings.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';
// PORT NOTE (Sabbir Book): `../../config/localUpload` (uploadFileLocal) is NOT yet ported.
// Its import and the `/upload-logo` route below are commented out so this module compiles.
// Restore BOTH lines together once config/localUpload.ts exists.
// import { uploadFileLocal } from '../../config/localUpload';

const router = express.Router();

// Get site settings (public — Navbar/Footer/home read this without auth)
router.get('/', SettingsController.getSettingsController);

// Update site settings (admin / superAdmin only — NOT trainingManager)
router.patch('/', authMiddleware, authorize('admin', 'superAdmin'), SettingsController.updateSettingsController);

// Upload a new site logo (admin / superAdmin) → returns { url } to save via PATCH
// PORT NOTE: depends on uploadFileLocal (config/localUpload) — commented out until ported.
// router.post('/upload-logo', authMiddleware, authorize('admin', 'superAdmin'), uploadFileLocal.single('logo'), SettingsController.uploadLogoController);

export const SettingsRoutes = router;
