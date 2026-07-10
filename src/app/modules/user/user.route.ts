import express from 'express';
import { UserController } from './user.controller';
import validateRequest from '../../middlewares/validateRequest';
import { signupValidationSchema, googleLoginValidationSchema, createStaffValidationSchema, createStudentValidationSchema } from './user.validation';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { fixDuplicateUserIds } from './user.migration';

const router = express.Router();

// ── Public auth-adjacent endpoints (do NOT protect) ──
router.post('/signup', validateRequest(signupValidationSchema), UserController.createUserController);
router.post('/google-login', validateRequest(googleLoginValidationSchema), UserController.googleLoginController);

// ── Admin-only: create staff (admin/trainingManager) — admin role enforced superAdmin-only in the service ──
router.post('/create-staff', authMiddleware, authorize('admin', 'superAdmin'), validateRequest(createStaffValidationSchema), UserController.createStaffController);

// ── Create a student account — admin, superAdmin AND trainingManager (Manager) ──
router.post('/create-student', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager'), validateRequest(createStudentValidationSchema), UserController.createStudentController);

// ── List users — admin/superAdmin see all; trainingManager sees only students (filtered in controller) ──
router.get('/', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager'), UserController.getAllUsersController);

// Migration endpoint to fix duplicate user IDs (admin only) - MUST be before /:id routes
router.post('/fix-duplicate-ids', authMiddleware, authorize('admin', 'superAdmin'), async (req, res) => {
    try {
        const result = await fixDuplicateUserIds();
        res.status(200).json(result);
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ── Self-service: any authenticated user updates their OWN basic profile (must be BEFORE /:id) ──
router.patch('/profile', authMiddleware, UserController.updateOwnProfileController);

// ── Single-user management (read / update / delete) ──
// trainingManager is allowed here but the controller restricts them to student/user targets only.
// These must come AFTER specific routes
router.get('/:id', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager'), UserController.getSingleUserController);
router.patch('/:id', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager'), UserController.updateUserController);
router.delete('/:id', authMiddleware, authorize('admin', 'superAdmin', 'trainingManager'), UserController.deleteUserController);

export const UserRoutes = router;
