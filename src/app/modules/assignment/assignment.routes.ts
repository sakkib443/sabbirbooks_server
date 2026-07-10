import express from 'express';
import { AssignmentController } from './assignment.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// Student routes (BEFORE /:id)
router.get('/my-submissions', authMiddleware, AssignmentController.mySubmissions);
router.get('/course/:courseId', authMiddleware, AssignmentController.studentAssignments);

// CRUD
router.post('/', authMiddleware, authorize('admin', 'mentor', 'trainingManager'), AssignmentController.create);
router.get('/', authMiddleware, AssignmentController.getAll);
router.get('/:id', authMiddleware, AssignmentController.getOne);
router.patch('/:id', authMiddleware, authorize('admin', 'mentor'), AssignmentController.update);
router.delete('/:id', authMiddleware, authorize('admin', 'mentor'), AssignmentController.remove);

// Submit
router.post('/:id/submit', authMiddleware, AssignmentController.submit);
router.get('/:id/submissions', authMiddleware, authorize('admin', 'mentor'), AssignmentController.getSubmissions);

// Grade a single online submission
router.patch('/submissions/:submissionId/grade', authMiddleware, authorize('admin', 'mentor'), AssignmentController.grade);

// Bulk marks entry for all batch students (offline gradebook)
router.post('/:id/marks', authMiddleware, authorize('admin', 'mentor', 'trainingManager'), AssignmentController.setMarks);

// Batch progress matrix (assignment marks + overall) — mentor/admin/TM
router.get('/batch/:batchId/progress', authMiddleware, authorize('admin', 'mentor', 'trainingManager'), AssignmentController.batchProgress);

export const AssignmentRoutes = router;
