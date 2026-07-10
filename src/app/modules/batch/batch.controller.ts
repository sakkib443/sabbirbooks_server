/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { BatchService } from './batch.service';

export const createBatchController = async (req: Request, res: Response) => {
    try {
        const result = await BatchService.createBatch(req.body);
        res.status(201).json({
            success: true,
            message: 'Batch created successfully',
            data: result,
        });
    } catch (error: any) {
        const msg = error?.message || 'Error creating batch';
        const isValidation = /required|already exists|empty|before|cannot be/i.test(msg);
        res.status(isValidation ? 400 : 500).json({ success: false, message: msg });
    }
};

export const getAllBatchesController = async (req: Request, res: Response) => {
    try {
        const batches = await BatchService.getAllBatches();
        res.status(200).json({
            success: true,
            message: 'Batches retrieved successfully',
            data: batches,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getBatchByIdController = async (req: Request, res: Response) => {
    try {
        const batch = await BatchService.getBatchById(req.params.id);
        if (!batch) {
            return res.status(404).json({ success: false, message: 'Batch not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Batch retrieved successfully',
            data: batch,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getBatchesByCourseController = async (req: Request, res: Response) => {
    try {
        const batches = await BatchService.getBatchesByCourse(req.params.courseId);
        res.status(200).json({
            success: true,
            message: 'Batches retrieved successfully',
            data: batches,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateBatchController = async (req: Request, res: Response) => {
    try {
        const batch = await BatchService.updateBatch(req.params.id, req.body);
        if (!batch) {
            return res.status(404).json({ success: false, message: 'Batch not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Batch updated successfully',
            data: batch,
        });
    } catch (error: any) {
        const msg = error?.message || 'Error updating batch';
        const isValidation = /required|already exists|empty|before|cannot be/i.test(msg);
        res.status(isValidation ? 400 : 500).json({ success: false, message: msg });
    }
};

export const deleteBatchController = async (req: Request, res: Response) => {
    try {
        const batch = await BatchService.deleteBatch(req.params.id);
        if (!batch) {
            return res.status(404).json({ success: false, message: 'Batch not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Batch deleted successfully',
            data: batch,
        });
    } catch (error: any) {
        const msg = error?.message || 'Error deleting batch';
        const isBlocked = /cannot delete/i.test(msg);
        res.status(isBlocked ? 409 : 500).json({ success: false, message: msg });
    }
};

export const getBatchesByMentorController = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?._id;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const batches = await BatchService.getBatchesByMentor(userId);
        res.status(200).json({ success: true, data: batches });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const BatchController = {
    createBatchController,
    getAllBatchesController,
    getBatchByIdController,
    getBatchesByCourseController,
    getBatchesByMentorController,
    updateBatchController,
    deleteBatchController,
};
