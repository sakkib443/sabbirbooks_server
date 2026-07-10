/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { QrResourceService } from './qrResource.service';

// CREATE QrResource (admin) — auto-generates a unique slug when omitted.
export const createQrResourceController = async (req: Request, res: Response) => {
  try {
    const resource = await QrResourceService.createQrResourceServices(req.body);
    res.status(201).json({ success: true, message: 'QR resource created successfully', data: resource });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET All QR resources (admin) — supports ?search=&book=&status=&page=&limit=
export const getAllQrResourcesController = async (req: Request, res: Response) => {
  try {
    const { search, book, status, page, limit } = req.query;
    const result = await QrResourceService.getAllQrResourcesServices({
      search: search as string,
      book: book as string,
      status: status as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    res.status(200).json({
      success: true,
      data: result.resources,
      meta: { total: result.total, page: result.page, totalPages: result.totalPages },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUBLIC — GET /:slug — the page a scanned QR code opens. Increments views; no auth.
export const getPublicQrResourceController = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const resource = await QrResourceService.getPublicQrResourceBySlug(slug);
    if (!resource) return res.status(404).json({ success: false, message: 'QR resource not found' });
    res.status(200).json({ success: true, data: resource });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ADMIN — GET /admin/:id — fetch one by _id for editing (any status).
export const getQrResourceByIdController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const resource = await QrResourceService.getQrResourceByIdServices(id);
    if (!resource) return res.status(404).json({ success: false, message: 'QR resource not found' });
    res.status(200).json({ success: true, data: resource });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// UPDATE QrResource by _id (admin)
export const updateQrResourceController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await QrResourceService.updateQrResourceServices(id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'QR resource not found' });
    res.status(200).json({ success: true, message: 'QR resource updated successfully', data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE QrResource by _id (admin)
export const deleteQrResourceController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await QrResourceService.deleteQrResourceServices(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'QR resource not found' });
    res.status(200).json({ success: true, message: 'Deleted successfully', data: deleted });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const QrResourceController = {
  createQrResourceController,
  getAllQrResourcesController,
  getPublicQrResourceController,
  getQrResourceByIdController,
  updateQrResourceController,
  deleteQrResourceController,
};
