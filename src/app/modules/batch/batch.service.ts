/* eslint-disable @typescript-eslint/no-explicit-any */
import { Batch } from './batch.model';
import { IBatch } from './batch.interface';
import { Mentor } from '../mentor/mentor.model';
import { Enrollment } from '../enrollment/enrollment.model';

// Derive batch status purely from its dates — single source of truth so the
// status never goes stale as time passes (before = upcoming, during = active,
// after = completed).
const computeStatus = (
    start?: Date | string,
    end?: Date | string
): 'active' | 'completed' | 'upcoming' => {
    if (!start || !end) return 'upcoming';
    const now = new Date();
    const s = new Date(start);
    const e = new Date(end);
    if (now > e) return 'completed';
    if (now >= s) return 'active';
    return 'upcoming';
};

// Accurate per-batch student counts in ONE aggregation (not N queries, and not
// dependent on the client loading every enrollment).
const getStudentCounts = async (): Promise<Map<string, number>> => {
    const counts = await Enrollment.aggregate([
        {
            $match: {
                isDeleted: false,
                batchId: { $ne: null },
                status: { $nin: ['cancelled', 'deleted'] },
            },
        },
        { $group: { _id: '$batchId', n: { $sum: 1 } } },
    ]);
    return new Map(counts.map((c: any) => [String(c._id), c.n]));
};

// Create a new batch — batch id MUST be provided manually by admin
const createBatch = async (payload: Partial<IBatch>): Promise<IBatch> => {
    const id = (payload.id || '').trim();
    if (!id) {
        throw new Error('Batch ID is required. Please enter a batch ID manually.');
    }
    if (!payload.startDate || !payload.endDate) {
        throw new Error('Start date and end date are required.');
    }
    if (new Date(payload.endDate) < new Date(payload.startDate)) {
        throw new Error('End date cannot be before the start date.');
    }

    // If the id belongs to a still-live batch → block. If it belongs to a
    // previously soft-deleted batch, resurrect that record instead of hitting
    // the global unique index with a raw E11000 error.
    const existing = await Batch.findOne({ id });
    if (existing && !existing.isDeleted) {
        throw new Error(`Batch ID "${id}" already exists. Please choose a different ID.`);
    }

    const batchData = {
        ...payload,
        id,
        name: payload.name || `${payload.courseName} - ${id}`,
        status: computeStatus(payload.startDate, payload.endDate),
        isDeleted: false,
    };

    if (existing && existing.isDeleted) {
        Object.assign(existing, batchData);
        await existing.save();
        return existing;
    }

    const newBatch = await Batch.create(batchData);
    return newBatch;
};

// Get all batches (course + mentor populated, live student counts, fresh status)
const getAllBatches = async (): Promise<any[]> => {
    const [batches, countMap] = await Promise.all([
        Batch.find({ isDeleted: false })
            .populate('courseId', 'title image type')
            .populate('mentorId', 'name image designation')
            .sort({ createdAt: -1 })
            .lean(),
        getStudentCounts(),
    ]);

    return batches.map((b: any) => ({
        ...b,
        studentCount: countMap.get(String(b._id)) || 0,
        status: computeStatus(b.startDate, b.endDate),
    }));
};

// Get single batch by ID
const getBatchById = async (id: string): Promise<any | null> => {
    const batch = await Batch.findOne({ id, isDeleted: false })
        .populate('courseId', 'title image type')
        .populate('mentorId', 'name image designation')
        .lean();
    if (!batch) return null;
    return { ...batch, status: computeStatus((batch as any).startDate, (batch as any).endDate) };
};

// Get batches by course
const getBatchesByCourse = async (courseId: string): Promise<any[]> => {
    const batches = await Batch.find({ courseId, isDeleted: false })
        .populate('courseId', 'title image type')
        .sort({ createdAt: -1 })
        .lean();
    return batches.map((b: any) => ({ ...b, status: computeStatus(b.startDate, b.endDate) }));
};

// Update batch — allow editing id manually too, with uniqueness check
const updateBatch = async (id: string, payload: Partial<IBatch>): Promise<IBatch | null> => {
    if (payload.id !== undefined) {
        const newId = (payload.id || '').trim();
        if (!newId) {
            throw new Error('Batch ID cannot be empty.');
        }
        if (newId !== id) {
            const clash = await Batch.findOne({ id: newId }).lean();
            if (clash) {
                throw new Error(`Batch ID "${newId}" already exists.`);
            }
        }
        payload.id = newId;
    }

    const current = await Batch.findOne({ id, isDeleted: false });
    if (!current) return null;

    // Recompute status from the resulting dates so it can never drift.
    const start = payload.startDate ?? current.startDate;
    const end = payload.endDate ?? current.endDate;
    if (start && end && new Date(end) < new Date(start)) {
        throw new Error('End date cannot be before the start date.');
    }
    (payload as any).status = computeStatus(start, end);

    const batch = await Batch.findOneAndUpdate({ id, isDeleted: false }, payload, { new: true })
        .populate('courseId', 'title image type')
        .populate('mentorId', 'name image designation');
    return batch;
};

// Delete batch (soft delete) — blocked if students are still assigned (would orphan their batchId)
const deleteBatch = async (id: string): Promise<IBatch | null> => {
    const target = await Batch.findOne({ id, isDeleted: false });
    if (!target) return null;

    const assigned = await Enrollment.countDocuments({
        batchId: target._id,
        isDeleted: false,
        status: { $nin: ['cancelled', 'deleted'] },
    });
    if (assigned > 0) {
        throw new Error(`Cannot delete: ${assigned} student${assigned > 1 ? 's are' : ' is'} still assigned to this batch. Move or unassign them first.`);
    }

    target.isDeleted = true;
    await target.save();
    return target;
};

// Get batches by mentor (via userId)
const getBatchesByMentor = async (userId: string): Promise<any[]> => {
    const mentor = await Mentor.findOne({ userId });
    if (!mentor) return [];
    const batches = await Batch.find({ mentorId: mentor._id, isDeleted: false })
        .populate('courseId', 'title image type fee')
        .populate('mentorId', 'name image designation')
        .sort({ startDate: -1 })
        .lean();
    return batches.map((b: any) => ({ ...b, status: computeStatus(b.startDate, b.endDate) }));
};

export const BatchService = {
    createBatch,
    getAllBatches,
    getBatchById,
    getBatchesByCourse,
    getBatchesByMentor,
    updateBatch,
    deleteBatch,
};
