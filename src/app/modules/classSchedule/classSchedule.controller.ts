/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { ClassScheduleService } from './classSchedule.service';

const create = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    // Auto-set mentorId from authenticated user
    if (!req.body.mentorId && user?._id) {
      req.body.mentorId = user._id;
    }
    const result = await ClassScheduleService.createClass(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getAll = async (req: Request, res: Response) => {
  try {
    const result = await ClassScheduleService.getAllClasses(req.query as any);
    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getOne = async (req: Request, res: Response) => {
  try {
    const result = await ClassScheduleService.getClass(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Class not found' });
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    // A mentor may only update their OWN class.
    if (user?.role === 'mentor') {
      const cls = await ClassScheduleService.getClass(req.params.id);
      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
      if (String((cls as any).mentorId?._id || (cls as any).mentorId) !== String(user._id)) {
        return res.status(403).json({ success: false, message: 'You can only update your own class' });
      }
    }
    const result = await ClassScheduleService.updateClass(req.params.id, req.body);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const remove = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    // A mentor may only delete their OWN class (class.mentorId is the mentor's User _id).
    if (user?.role === 'mentor') {
      const cls = await ClassScheduleService.getClass(req.params.id);
      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
      if (String((cls as any).mentorId?._id || (cls as any).mentorId) !== String(user._id)) {
        return res.status(403).json({ success: false, message: 'You can only delete your own class' });
      }
    }
    await ClassScheduleService.deleteClass(req.params.id);
    res.status(200).json({ success: true, message: 'Deleted' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Mentor: My Classes
const myClasses = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { dateFrom, dateTo } = req.query;
    const result = await ClassScheduleService.getMentorClasses(
      user._id, dateFrom as string, dateTo as string
    );
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Mentor: Upload Recording
const uploadRecording = async (req: Request, res: Response) => {
  try {
    const { recordingUrl } = req.body;
    const result = await ClassScheduleService.uploadRecording(req.params.id, recordingUrl);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Add a recording (multi-recording support)
const addRecording = async (req: Request, res: Response) => {
  try {
    const { title, url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'Recording URL required' });
    const result = await ClassScheduleService.addRecording(req.params.id, {
      title: title || 'Recording',
      url,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Remove a recording by index
const removeRecording = async (req: Request, res: Response) => {
  try {
    const { index } = req.params;
    const result = await ClassScheduleService.removeRecording(req.params.id, Number(index));
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Add material to class
const addMaterial = async (req: Request, res: Response) => {
  try {
    const result = await ClassScheduleService.addMaterial(req.params.id, req.body);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Remove material
const removeMaterial = async (req: Request, res: Response) => {
  try {
    const { index } = req.params;
    const result = await ClassScheduleService.removeMaterial(req.params.id, Number(index));
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Student: My schedule (by enrolled batches)
// Security: Validate that user is actually enrolled in the requested batches
const studentSchedule = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { batchIds, dateFrom, dateTo } = req.query;
    const requestedIds = typeof batchIds === 'string' ? batchIds.split(',').filter(Boolean) : [];

    if (requestedIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Verify the student is enrolled in these batches
    const { Enrollment } = await import('../enrollment/enrollment.model');
    const enrollments = await Enrollment.find({
      studentId: user._id,
      batchId: { $in: requestedIds },
      isDeleted: false,
      status: 'active',
    }).lean();

    // Only allow batch IDs the student is actually enrolled in
    const allowedBatchIds: string[] = enrollments
      .map(e => e.batchId?.toString())
      .filter((id): id is string => !!id);

    if (allowedBatchIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const result = await ClassScheduleService.getStudentClasses(
      allowedBatchIds, dateFrom as string, dateTo as string
    );
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Today's classes
const todayClasses = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await ClassScheduleService.getTodayClasses(user._id, user.role);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Stats
const stats = async (req: Request, res: Response) => {
  try {
    const result = await ClassScheduleService.getStats();
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Send to Students
const sendToStudents = async (req: Request, res: Response) => {
  try {
    const result = await ClassScheduleService.sendToStudents(req.params.id);
    res.status(200).json({ success: true, message: 'Sent to students', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get classes by batch — a mentor may only read their OWN batch's classes (IDOR guard)
const getByBatch = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const batchId = req.params.batchId;
    if (user?.role === 'mentor') {
      const { Batch } = await import('../batch/batch.model');
      const { Mentor } = await import('../mentor/mentor.model');
      const [batch, mentor] = await Promise.all([
        Batch.findById(batchId).select('mentorId'),
        Mentor.findOne({ userId: user._id }).select('_id'),
      ]);
      if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
      if (!mentor || String((batch as any).mentorId) !== String(mentor._id)) {
        return res.status(403).json({ success: false, message: 'You are not assigned to this batch' });
      }
    }
    const result = await ClassScheduleService.getClassesByBatch(batchId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Upload material file (local disk) — returns a public /uploads URL
const uploadMaterial = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const base = `${req.protocol}://${req.get('host')}`;
    // Local disk storage → build a public URL from the saved filename; fall back to any cloud fields.
    const fileUrl = file.filename ? `${base}/uploads/materials/${file.filename}` : (file.path || file.secure_url || file.url);
    const originalName = file.originalname || 'file';
    const ext = originalName.split('.').pop()?.toLowerCase() || 'pdf';
    res.status(200).json({
      success: true,
      data: {
        fileUrl,
        fileName: originalName,
        fileType: ext,
        size: file.size,
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const ClassScheduleController = {
  create, getAll, getOne, update, remove,
  myClasses, uploadRecording, addRecording, removeRecording, addMaterial, removeMaterial,
  studentSchedule, todayClasses, stats,
  sendToStudents, getByBatch, uploadMaterial,
};
