// src/app/modules/auth/auth.routes.ts
import express from 'express';
import {
  registerController,
  loginController,
  refreshTokenController,
  getMeController,
  changePasswordController,
  logoutController,
  logoutAllController,
  sessionsController,
} from './auth.controller';
import validateRequest from '../../middlewares/validateRequest';
import { loginValidationSchema, registerValidationSchema } from './auth.validation';
import { authMiddleware } from '../../middlewares/auth';

const router = express.Router();

router.post('/register', validateRequest(registerValidationSchema), registerController);
router.post('/login', validateRequest(loginValidationSchema), loginController);
router.post('/refresh-token', refreshTokenController);

// Token verification endpoint
router.get('/me', authMiddleware, getMeController);

// Change password
router.post('/change-password', authMiddleware, changePasswordController);

// ── Device-limit session management (all require a valid access token) ──
router.post('/logout', authMiddleware, logoutController);
router.post('/logout-all', authMiddleware, logoutAllController);
router.get('/sessions', authMiddleware, sessionsController);

export const AuthRoutes = router;
