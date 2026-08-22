import express from 'express';
import { MentorController } from './mentor.controller';
import validateRequest from '../../middlewares/validateRequest';
import { mentorValidationSchema } from './mentor.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Mentor profiles are public-facing content — see book.routes.ts for the pattern.
const adminOnly = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager', 'contentManager', 'manager'),
  requireCapability('content.write'),
];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.
const adminOnlyDelete = [...adminOnly, requireCapability('records.delete')];

// Mentor self-profile (token-based)
router.get('/me', authMiddleware, MentorController.getMyMentorProfile);
router.patch('/me/update', authMiddleware, MentorController.updateMyMentorProfile);

// Reads are public; create/update/delete are admin-only (were previously OPEN to anyone)
router.post('/create-mentor', ...adminOnly, validateRequest(mentorValidationSchema), MentorController.createMentorController);
router.get('/', MentorController.getAllMentorsController);
router.get('/:id', MentorController.getSingleMentorController);
router.patch('/:id', ...adminOnly, MentorController.updateMentorController);
router.delete('/:id', ...adminOnlyDelete, MentorController.deleteMentorController);

export const MentorRoutes = router;
