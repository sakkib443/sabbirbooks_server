// src/app/modules/auth/auth.routes.ts
import express from 'express';
import {
  registerController,
  loginController,
  refreshTokenController,
  getMeController,
  changePasswordController,
  forgotPasswordController,
  resetPasswordController,
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

// Forgot password — public by nature. The email link is the verification;
// see AuthService.requestPasswordReset for why these never say whether an
// address has an account, and how they are throttled.
router.post('/forgot-password', forgotPasswordController);
router.post('/reset-password', resetPasswordController);

// ── Device-limit session management (all require a valid access token) ──
router.post('/logout', authMiddleware, logoutController);
router.post('/logout-all', authMiddleware, logoutAllController);
router.get('/sessions', authMiddleware, sessionsController);

export const AuthRoutes = router;
