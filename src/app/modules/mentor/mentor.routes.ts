import express from 'express';
import { MentorController } from './mentor.controller';
import validateRequest from '../../middlewares/validateRequest';
import { mentorValidationSchema } from './mentor.validation';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

const adminOnly = [authMiddleware, authorize('admin', 'superAdmin', 'trainingManager')];

// Mentor self-profile (token-based)
router.get('/me', authMiddleware, MentorController.getMyMentorProfile);
router.patch('/me/update', authMiddleware, MentorController.updateMyMentorProfile);

// Reads are public; create/update/delete are admin-only (were previously OPEN to anyone)
router.post('/create-mentor', ...adminOnly, validateRequest(mentorValidationSchema), MentorController.createMentorController);
router.get('/', MentorController.getAllMentorsController);
router.get('/:id', MentorController.getSingleMentorController);
router.patch('/:id', ...adminOnly, MentorController.updateMentorController);
router.delete('/:id', ...adminOnly, MentorController.deleteMentorController);

export const MentorRoutes = router;
