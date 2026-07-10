/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { AssignmentService } from './assignment.service';

const create = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await AssignmentService.create({ ...req.body, createdBy: user._id });
    res.status(201).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getAll = async (req: Request, res: Response) => {
  try {
    const result = await AssignmentService.getAll(req.query as any);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getOne = async (req: Request, res: Response) => {
  try {
    const result = await AssignmentService.getOne(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const update = async (req: Request, res: Response) => {
  try {
    const result = await AssignmentService.update(req.params.id, req.body);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const remove = async (req: Request, res: Response) => {
  try {
    await AssignmentService.remove(req.params.id);
    res.status(200).json({ success: true, message: 'Deleted' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const submit = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await AssignmentService.submit({ ...req.body, assignmentId: req.params.id, studentId: user._id });
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getSubmissions = async (req: Request, res: Response) => {
  try {
    const result = await AssignmentService.getSubmissions(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const grade = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { marks, feedback } = req.body;
    const result = await AssignmentService.grade(req.params.submissionId, marks, feedback, user._id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// Bulk marks entry for a batch's students (mentor's offline gradebook)
const setMarks = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await AssignmentService.setMarks(req.params.id, req.body.marks || [], user._id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// Batch progress matrix (assignment marks + overall) — mentor restricted to their own batch
const batchProgress = async (req: Request, res: Response) => {
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
    const result = await AssignmentService.getBatchProgress(batchId);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const mySubmissions = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await AssignmentService.getStudentSubmissions(user._id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const studentAssignments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await AssignmentService.getStudentAssignments(user._id, req.params.courseId);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

export const AssignmentController = {
  create, getAll, getOne, update, remove,
  submit, getSubmissions, grade, setMarks, batchProgress,
  mySubmissions, studentAssignments,
};
