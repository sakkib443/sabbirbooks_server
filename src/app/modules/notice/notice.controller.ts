/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { Notice } from './notice.model';
import { Enrollment } from '../enrollment/enrollment.model';

const uid = (req: Request) => (req as any).user?._id || (req as any).user?.id;

// ═══════════════ PUBLIC (footer page) ═══════════════
// GET /public — only public + active notices, no auth
export const getPublic = async (_req: Request, res: Response) => {
  try {
    const list = await Notice.find({ audience: 'public', isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ═══════════════ STUDENT board ═══════════════
// GET /my — public notices + (enrolled-only notices IF the student has an active enrollment)
export const getForStudent = async (req: Request, res: Response) => {
  try {
    const hasActiveEnrollment = await Enrollment.exists({
      studentId: uid(req), status: 'active', isDeleted: false,
    });
    const audiences = hasActiveEnrollment ? ['public', 'enrolled'] : ['public'];
    const list = await Notice.find({ audience: { $in: audiences }, isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ═══════════════ ADMIN / MANAGER ═══════════════
export const getAll = async (_req: Request, res: Response) => {
  try {
    const list = await Notice.find().sort({ createdAt: -1 }).populate('createdBy', 'firstName lastName');
    res.json({ success: true, data: list });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const create = async (req: Request, res: Response) => {
  try {
    const { title } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ success: false, message: 'Title required' });
    const notice = await Notice.create({ ...req.body, createdBy: uid(req) });
    res.status(201).json({ success: true, data: notice });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const update = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Notice not found' });
    const notice = await Notice.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!notice) return res.status(404).json({ success: false, message: 'Notice not found' });
    res.json({ success: true, data: notice });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const remove = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Notice not found' });
    const notice = await Notice.findByIdAndDelete(req.params.id);
    if (!notice) return res.status(404).json({ success: false, message: 'Notice not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// POST /upload — PDF/image attachment (local disk), returns { url, type, name }
export const uploadAttachment = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const base = `${req.protocol}://${req.get('host')}`;
    const url = file.filename ? `${base}/uploads/materials/${file.filename}` : (file.path || file.url);
    const ext = (file.originalname || '').split('.').pop()?.toLowerCase() || '';
    const type = /^(png|jpe?g|webp|gif)$/.test(ext) ? 'image' : (ext === 'pdf' ? 'pdf' : 'file');
    res.status(200).json({ success: true, data: { url, type, name: file.originalname || 'file' } });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};
