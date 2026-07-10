/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { AttendanceService } from './attendance.service';

const takeAttendance = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { batchId, date, classTitle, records } = req.body;
    if (!batchId || !date || !records?.length) {
      return res.status(400).json({ success: false, message: 'batchId, date, and records are required' });
    }
    const result = await AttendanceService.takeAttendance({
      batchId,
      mentorId: user._id,
      date,
      classTitle,
      records,
    });
    res.status(200).json({ success: true, message: 'Attendance saved', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getByDate = async (req: Request, res: Response) => {
  try {
    const { batchId, date } = req.query;
    if (!batchId || !date) {
      return res.status(400).json({ success: false, message: 'batchId and date required' });
    }
    const result = await AttendanceService.getAttendanceByDate(batchId as string, date as string);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getHistory = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const result = await AttendanceService.getBatchAttendanceHistory(batchId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getStats = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const result = await AttendanceService.getBatchAttendanceStats(batchId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteAttendance = async (req: Request, res: Response) => {
  try {
    await AttendanceService.deleteAttendance(req.params.id);
    res.status(200).json({ success: true, message: 'Deleted' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Student: my attendance (self-scoped via token) ────────
const getMyAttendance = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { records } = await AttendanceService.getMyAttendance(user._id);
    res.status(200).json({ success: true, data: records });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getMySummary = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { summary } = await AttendanceService.getMyAttendance(user._id);
    res.status(200).json({ success: true, data: summary });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Per-batch summary for one course (My Progress page): /attendance/my-summary?batchId=
const getMyBatchSummary = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ success: false, message: 'batchId required' });
    const { summary } = await AttendanceService.getMyBatchAttendance(user._id, batchId as string);
    res.status(200).json({ success: true, data: summary });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const AttendanceController = {
  takeAttendance,
  getByDate,
  getHistory,
  getStats,
  deleteAttendance,
  getMyAttendance,
  getMySummary,
  getMyBatchSummary,
};
