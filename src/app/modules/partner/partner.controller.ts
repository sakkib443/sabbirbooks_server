/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { Partner } from './partner.model';

const uid = (req: Request) => (req as any).user?._id || (req as any).user?.id;

// ═══════════════ PUBLIC (homepage carousel) ═══════════════
export const getPublic = async (_req: Request, res: Response) => {
  try {
    const list = await Partner.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// ═══════════════ ADMIN / MANAGER ═══════════════
export const getAll = async (_req: Request, res: Response) => {
  try {
    const list = await Partner.find().sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const create = async (req: Request, res: Response) => {
  try {
    const { name, logoUrl } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Name required' });
    if (!logoUrl) return res.status(400).json({ success: false, message: 'Logo required' });
    const partner = await Partner.create({ ...req.body, createdBy: uid(req) });
    res.status(201).json({ success: true, data: partner });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const update = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Partner not found' });
    const partner = await Partner.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });
    res.json({ success: true, data: partner });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const remove = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Partner not found' });
    const partner = await Partner.findByIdAndDelete(req.params.id);
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// POST /upload — logo image (local disk) → returns { url }
export const uploadLogo = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const base = `${req.protocol}://${req.get('host')}`;
    const url = file.filename ? `${base}/uploads/materials/${file.filename}` : (file.path || file.url);
    res.status(200).json({ success: true, data: { url } });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};
