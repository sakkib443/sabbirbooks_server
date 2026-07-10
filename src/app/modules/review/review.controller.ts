/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { ReviewService } from './review.service';

// Map validation / duplicate-key / cast errors to 400, everything else to 500
const sendError = (res: Response, error: any) => {
    const isClientError =
        error?.name === 'ValidationError' ||
        error?.name === 'CastError' ||
        error?.code === 11000;
    return res
        .status(isClientError ? 400 : 500)
        .json({ success: false, message: error?.message || 'Something went wrong' });
};

// CREATE - public
const createReviewController = async (req: Request, res: Response) => {
    try {
        const { name, rating, text } = req.body;
        if (!name || !text || !rating) {
            return res.status(400).json({ success: false, message: 'Name, rating and review text are required.' });
        }
        const review = await ReviewService.createReviewService(req.body);
        res.status(201).json({ success: true, message: 'Thank you! Your review has been added.', data: review });
    } catch (error: any) {
        sendError(res, error);
    }
};

// GET approved (public)
const getApprovedReviewsController = async (_req: Request, res: Response) => {
    try {
        const reviews = await ReviewService.getApprovedReviewsService();
        res.status(200).json({ success: true, data: reviews });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET all (admin)
const getAllReviewsController = async (_req: Request, res: Response) => {
    try {
        const reviews = await ReviewService.getAllReviewsService();
        res.status(200).json({ success: true, data: reviews });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// UPDATE (admin)
const updateReviewController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updated = await ReviewService.updateReviewService(id, req.body);
        if (!updated) return res.status(404).json({ success: false, message: 'Review not found' });
        res.status(200).json({ success: true, message: 'Review updated', data: updated });
    } catch (error: any) {
        sendError(res, error);
    }
};

// DELETE (admin)
const deleteReviewController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const deleted = await ReviewService.deleteReviewService(id);
        if (!deleted) return res.status(404).json({ success: false, message: 'Review not found' });
        res.status(200).json({ success: true, message: 'Review deleted', data: deleted });
    } catch (error: any) {
        sendError(res, error);
    }
};

export const ReviewController = {
    createReviewController,
    getApprovedReviewsController,
    getAllReviewsController,
    updateReviewController,
    deleteReviewController,
};
