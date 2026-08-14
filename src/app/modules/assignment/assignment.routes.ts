import express from 'express';
import { AssignmentController } from './assignment.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Assignments are course delivery → `training.manage`. Role lists are unchanged;
// mentor and trainingManager both hold that capability by default, so nothing
// changes today — but an admin can now revoke it from a manager in the matrix.
// A contentManager is in none of these role lists and never reaches them.

// Student routes (BEFORE /:id)
router.get('/my-submissions', authMiddleware, AssignmentController.mySubmissions);
router.get('/course/:courseId', authMiddleware, AssignmentController.studentAssignments);

// CRUD
router.post('/', authMiddleware, authorize('admin', 'mentor', 'trainingManager'), requireCapability('training.manage'), AssignmentController.create);
router.get('/', authMiddleware, AssignmentController.getAll);
router.get('/:id', authMiddleware, AssignmentController.getOne);
router.patch('/:id', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), AssignmentController.update);
router.delete('/:id', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), AssignmentController.remove);

// Submit
router.post('/:id/submit', authMiddleware, AssignmentController.submit);
router.get('/:id/submissions', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), AssignmentController.getSubmissions);

// Grade a single online submission
router.patch('/submissions/:submissionId/grade', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), AssignmentController.grade);

// Bulk marks entry for all batch students (offline gradebook)
router.post('/:id/marks', authMiddleware, authorize('admin', 'mentor', 'trainingManager'), requireCapability('training.manage'), AssignmentController.setMarks);

// Batch progress matrix (assignment marks + overall) — mentor/admin/TM
router.get('/batch/:batchId/progress', authMiddleware, authorize('admin', 'mentor', 'trainingManager'), requireCapability('training.manage'), AssignmentController.batchProgress);

export const AssignmentRoutes = router;
