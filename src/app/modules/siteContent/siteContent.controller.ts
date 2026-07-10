/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { SiteContent } from './siteContent.model';

// GET /:page — public read (the website page renders from this)
export const getPageContent = async (req: Request, res: Response) => {
  try {
    const doc = await SiteContent.findOne({ page: String(req.params.page).toLowerCase() });
    res.json({ success: true, data: { page: req.params.page, content: doc?.content || {} } });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// GET / — admin: list which pages have content
export const listPages = async (_req: Request, res: Response) => {
  try {
    const rows = await SiteContent.find().select('page updatedAt').sort({ page: 1 });
    res.json({ success: true, data: rows });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// PUT /:page — admin: save the whole content object for a page (upsert)
export const savePageContent = async (req: Request, res: Response) => {
  try {
    const page = String(req.params.page).toLowerCase();
    const content = req.body?.content ?? req.body ?? {};
    const doc = await SiteContent.findOneAndUpdate(
      { page },
      { content, updatedBy: (req as any).user?._id },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, message: 'Saved', data: { page: doc.page, content: doc.content } });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const SiteContentController = { getPageContent, listPages, savePageContent };
