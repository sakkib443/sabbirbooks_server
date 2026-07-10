import { isValidObjectId } from 'mongoose';
import { Review } from './review.model';
import { IReview } from './review.interface';

// CREATE - public submission (defaults to approved so it shows immediately)
const createReviewService = async (payload: Partial<IReview>): Promise<IReview> => {
    const newReview = await Review.create(payload);
    return newReview;
};

// READ - approved reviews only (public home page)
const getApprovedReviewsService = async (): Promise<IReview[]> => {
    return Review.find({ status: 'approved' }).sort({ createdAt: -1 });
};

// READ - all reviews (admin)
const getAllReviewsService = async (): Promise<IReview[]> => {
    return Review.find({}).sort({ createdAt: -1 });
};

// UPDATE - status or fields (admin)
const updateReviewService = async (
    id: string,
    payload: Partial<IReview>
): Promise<IReview | null> => {
    // Guard against non-ObjectId ids (would throw a CastError → 500)
    if (!isValidObjectId(id)) return null;
    return Review.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
};

// DELETE (admin)
const deleteReviewService = async (id: string): Promise<IReview | null> => {
    if (!isValidObjectId(id)) return null;
    return Review.findByIdAndDelete(id);
};

export const ReviewService = {
    createReviewService,
    getApprovedReviewsService,
    getAllReviewsService,
    updateReviewService,
    deleteReviewService,
};
