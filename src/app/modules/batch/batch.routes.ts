import { Router } from 'express';
import { BatchController } from './batch.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = Router();

// Batches are a training operation. The role list is unchanged — `training.manage`
// is added on top so an admin can revoke it from a manager in the matrix.
const trainingWrite = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager'),
  requireCapability('training.manage'),
];

// Create new batch (admin only)
router.post('/', ...trainingWrite, BatchController.createBatchController);

// Get all batches (no auth needed for reading)
router.get('/', BatchController.getAllBatchesController);

// Get my batches (mentor only — uses token to find mentor)
router.get('/my-batches', authMiddleware, BatchController.getBatchesByMentorController);

// Get batches by course
router.get('/course/:courseId', BatchController.getBatchesByCourseController);

// Get single batch by ID
router.get('/:id', BatchController.getBatchByIdController);

// Update batch (admin only)
router.patch('/:id', ...trainingWrite, BatchController.updateBatchController);

// Delete batch (admin / superAdmin / trainingManager — Manager manages batches fully)
router.delete('/:id', ...trainingWrite, BatchController.deleteBatchController);

export const BatchRoutes = router;
