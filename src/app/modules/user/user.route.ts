import express from 'express';
import rateLimit from 'express-rate-limit';
import { UserController } from './user.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  signupValidationSchema,
  createStaffValidationSchema,
  createStudentValidationSchema,
  setPermissionsValidationSchema,
  googleSignInValidationSchema,
} from './user.validation';
import {
  googleSignInController,
  requireGoogleConfigured,
} from '../auth/google.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { fixDuplicateUserIds } from './user.migration';

const router = express.Router();

// ── Public auth-adjacent endpoints (do NOT protect) ──
router.post('/signup', validateRequest(signupValidationSchema), UserController.createUserController);

// DISABLED 2026-08-14 — account-takeover hole, not a Google login.
//
// The route took a plain { firstName, email, googleId } body, looked the user
// up by email alone and signed a JWT carrying that user's real role. Nothing
// anywhere verified a Google-issued ID token, so any unauthenticated caller
// could name an email address and be handed that account — including the
// superAdmin whose address is hardcoded in auth.service.ts. It also fell back
// to signing with the literal string 'default_secret' when JWT_ACCESS_SECRET
// was unset, and pinned its own 7d expiry instead of using config.jwt.
//
// Safe to remove: nothing in the client ever called it (zero hits for
// 'google-login' across sabbirbooks/src).
//
// Real Google sign-in replaces this — verify the ID token server-side with
// google-auth-library, require email_verified, then issue tokens through the
// existing generateTokens() in auth.service.ts. The googleId / authProvider
// fields on the User model are reusable as they are.
router.post('/google-login', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'This endpoint has been retired. Use POST /api/user/google-signin, which verifies a Google-issued ID token.',
  });
});

// ── Sign in with Google (the replacement for the route above) ──
//
// Public and unauthenticated by necessity — it is how a user authenticates.
// What makes it safe is the ONE thing it accepts: { credential }, Google's
// signed ID token. It is verified against Google's public keys for OUR client
// id, and email_verified must be true, before any account is looked up. See
// modules/auth/google.verify.ts for the full reasoning.
//
// Middleware order is deliberate:
//   requireGoogleConfigured → 503 when GOOGLE_CLIENT_ID is unset (the state
//                             this ships in), answered before the body is
//                             judged so the operator sees the real problem
//   googleSignInLimiter     → this endpoint can CREATE accounts, so it is the
//                             one public route worth flooding
//   validateRequest         → 400 for a missing/absurd credential
//   controller              → 401 for a token that will not verify
const googleSignInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many sign-in attempts, please wait a few minutes' },
});

router.post(
  '/google-signin',
  requireGoogleConfigured,
  googleSignInLimiter,
  validateRequest(googleSignInValidationSchema),
  googleSignInController,
);

// ── Admin-only: create staff (admin/trainingManager/contentManager) — admin role enforced superAdmin-only in the service ──
router.post('/create-staff', authMiddleware, authorize('admin', 'superAdmin'), requireCapability('staff.manage'), validateRequest(createStaffValidationSchema), UserController.createStaffController);

// ── The capability vocabulary for the admin permission matrix ──
// MUST be before '/:id' so the wildcard does not swallow it.
router.get('/permissions/catalog', authMiddleware, authorize('admin', 'superAdmin'), requireCapability('staff.manage'), UserController.getPermissionCatalogController);

// ── Create a student account — admin, superAdmin AND managers ──
router.post('/create-student', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager', 'contentManager'), requireCapability('users.write'), validateRequest(createStudentValidationSchema), UserController.createStudentController);

// ── List users — admin/superAdmin see all; managers see only students (filtered in controller) ──
// users.read is the gate that keeps a content-only manager away from personal data.
router.get('/', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager', 'contentManager'), requireCapability('users.read'), UserController.getAllUsersController);

// Migration endpoint to fix duplicate user IDs (admin only) - MUST be before /:id routes
router.post('/fix-duplicate-ids', authMiddleware, authorize('admin', 'superAdmin'), requireCapability('staff.manage'), async (req, res) => {
    try {
        const result = await fixDuplicateUserIds();
        res.status(200).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ── Self-service: any authenticated user updates their OWN basic profile (must be BEFORE /:id) ──
router.patch('/profile', authMiddleware, UserController.updateOwnProfileController);

// ── Set a manager's capabilities (the permission matrix writes here) ──
// The ONLY route that can write the `permissions` field. staff.manage is not a
// grantable capability, so a manager can never reach this endpoint and can
// therefore never raise their own permissions.
router.patch(
  '/:id/permissions',
  authMiddleware,
  authorize('admin', 'superAdmin'),
  requireCapability('staff.manage'),
  validateRequest(setPermissionsValidationSchema),
  UserController.updateUserPermissionsController,
);

// ── Single-user management (read / update / delete) ──
// Managers are allowed here but the controller restricts them to student/user targets only.
// These must come AFTER specific routes
router.get('/:id', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager', 'contentManager'), requireCapability('users.read'), UserController.getSingleUserController);
router.patch('/:id', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager', 'contentManager'), requireCapability('users.write'), UserController.updateUserController);
router.delete('/:id', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager', 'contentManager'), requireCapability('users.write'), UserController.deleteUserController);

export const UserRoutes = router;
