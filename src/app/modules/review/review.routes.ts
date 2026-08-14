import express from 'express';
import { ReviewController } from './review.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Approving/deleting a testimonial is content moderation — see book.routes.ts.
const contentWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'contentManager'),
  requireCapability('content.write'),
];

// Public: submit a review (with optional base64 image)
router.post('/create', ReviewController.createReviewController);

// Public: approved reviews for the home page
router.get('/', ReviewController.getApprovedReviewsController);

// Admin: all reviews (any status)
router.get('/all', ReviewController.getAllReviewsController);

// Admin: update status / fields
router.patch(
    '/:id',
    ...contentWrite,
    ReviewController.updateReviewController
);

// Admin: delete
router.delete(
    '/:id',
    ...contentWrite,
    ReviewController.deleteReviewController
);

export const ReviewRoutes = router;
