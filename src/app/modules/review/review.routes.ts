import express from 'express';
import { ReviewController } from './review.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// Public: submit a review (with optional base64 image)
router.post('/create', ReviewController.createReviewController);

// Public: approved reviews for the home page
router.get('/', ReviewController.getApprovedReviewsController);

// Admin: all reviews (any status)
router.get('/all', ReviewController.getAllReviewsController);

// Admin: update status / fields
router.patch(
    '/:id',
    authMiddleware,
    authorize('admin', 'trainingManager'),
    ReviewController.updateReviewController
);

// Admin: delete
router.delete(
    '/:id',
    authMiddleware,
    authorize('admin', 'trainingManager'),
    ReviewController.deleteReviewController
);

export const ReviewRoutes = router;
