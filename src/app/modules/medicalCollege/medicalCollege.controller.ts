/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { MedicalCollegeService } from './medicalCollege.service';

// GET /api/medical-colleges — public. The signup form needs this before the
// visitor has an account, so it carries no auth.
const list = async (req: Request, res: Response) => {
  try {
    const data = await MedicalCollegeService.listPublic({
      q: req.query.q as string,
      type: req.query.type as string,
      district: req.query.district as string,
    });
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/medical-colleges/regions — public, for filter dropdowns.
const regions = async (_req: Request, res: Response) => {
  try {
    const data = await MedicalCollegeService.getRegions();
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/medical-colleges/all — admin, includes retired and flagged rows.
const listAll = async (_req: Request, res: Response) => {
  try {
    const data = await MedicalCollegeService.listAll();
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const create = async (req: Request, res: Response) => {
  try {
    const data = await MedicalCollegeService.create(req.body);
    res.status(201).json({ success: true, message: 'College added', data });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'This college is already listed' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

const update = async (req: Request, res: Response) => {
  try {
    const data = await MedicalCollegeService.update(req.params.id, req.body);
    if (!data) return res.status(404).json({ success: false, message: 'College not found' });
    res.status(200).json({ success: true, message: 'College updated', data });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Another college already has that name' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// Retire, not delete — students reference these rows.
const deactivate = async (req: Request, res: Response) => {
  try {
    const data = await MedicalCollegeService.deactivate(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'College not found' });
    res.status(200).json({ success: true, message: 'College hidden from the list', data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const MedicalCollegeController = {
  list,
  regions,
  listAll,
  create,
  update,
  deactivate,
};
