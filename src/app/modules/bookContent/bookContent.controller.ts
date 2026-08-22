/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { publicBaseUrl } from '../../utils/publicBaseUrl';
import { BookContentService } from './bookContent.service';

/**
 * GET /api/book-content/scan/:qrCode  — the URL a printed QR opens.
 *
 * The three failure codes are load-bearing for the client:
 *   401 → send to login with ?redirect back here (handled by authMiddleware)
 *   403 → show the "buy this book" card, using the book in the payload
 *   404 → bad or unpublished code
 */
const scan = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    const result = await BookContentService.scanTopic(req.params.qrCode, userId);

    if (!result.ok && result.reason === 'not_found') {
      return res.status(404).json({ success: false, message: 'QR code not found' });
    }

    if (!result.ok && result.reason === 'no_access') {
      return res.status(403).json({
        success: false,
        message: 'You need to buy this book to view its contents',
        code: 'BOOK_NOT_PURCHASED',
        book: result.book,
      });
    }

    return res.status(200).json({ success: true, data: (result as { data: unknown }).data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/book-content/upload — PDFs, images and short answer videos.
 *
 * Files land on local disk (Cloudinary is not configured) under
 * <cwd>/uploads/materials and are served back by the static handler in app.ts.
 * In the container that path is the mounted volume, so uploads survive a
 * redeploy — without it every answer's PDF would vanish on the next push.
 */
const uploadFile = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const base = publicBaseUrl(req);
    const fileUrl = file.filename
      ? `${base}/uploads/materials/${file.filename}`
      : file.path || file.secure_url || file.url;

    const originalName = file.originalname || 'file';
    const ext = (originalName.split('.').pop() || '').toLowerCase();
    const isVideo = /^(mp4|webm|mov|mkv|avi)$/.test(ext);

    res.status(200).json({
      success: true,
      data: {
        fileUrl,
        fileName: originalName,
        fileType: ext,
        size: file.size,
        kind: isVideo ? 'video' : /^(png|jpe?g|webp|gif|svg)$/.test(ext) ? 'image' : 'document',
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getTree = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.getTree(req.params.bookId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getStats = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.getStats(req.params.bookId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getQrSheet = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.getQrSheet(req.params.bookId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getQuestionsByTopic = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.getQuestionsByTopic(req.params.topicId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getNextTopicForReader = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }
    const result = await BookContentService.getNextTopicForReader(req.params.topicId, userId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getNextUnanswered = async (req: Request, res: Response) => {
  try {
    const after = req.query.after ? Number(req.query.after) : undefined;
    const result = await BookContentService.getNextUnanswered(req.params.bookId, after);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const reorder = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.reorder(req.params.level as any, req.body.items);
    res.status(200).json({ success: true, message: 'Reordered', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// CRUD is uniform across the four levels, so the handlers are generated rather
// than written out sixteen times.
const LEVELS = ['part', 'chapter', 'topic', 'question'] as const;
type Level = (typeof LEVELS)[number];

const SERVICE_BY_LEVEL = {
  part: {
    create: BookContentService.createPart,
    update: BookContentService.updatePart,
    remove: BookContentService.deletePart,
  },
  chapter: {
    create: BookContentService.createChapter,
    update: BookContentService.updateChapter,
    remove: BookContentService.deleteChapter,
  },
  topic: {
    create: BookContentService.createTopic,
    update: BookContentService.updateTopic,
    remove: BookContentService.deleteTopic,
  },
  question: {
    create: BookContentService.createQuestion,
    update: BookContentService.updateQuestion,
    remove: BookContentService.deleteQuestion,
  },
} as const;

const makeCreate = (level: Level) => async (req: Request, res: Response) => {
  try {
    const result = await SERVICE_BY_LEVEL[level].create(req.body);
    res.status(201).json({ success: true, message: `${level} created`, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const makeUpdate = (level: Level) => async (req: Request, res: Response) => {
  try {
    const result = await SERVICE_BY_LEVEL[level].update(req.params.id, req.body);
    if (!result) return res.status(404).json({ success: false, message: `${level} not found` });
    res.status(200).json({ success: true, message: `${level} updated`, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const makeDelete = (level: Level) => async (req: Request, res: Response) => {
  try {
    await SERVICE_BY_LEVEL[level].remove(req.params.id);
    res.status(200).json({ success: true, message: `${level} deleted` });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const BookContentController = {
  scan,
  uploadFile,
  getTree,
  getStats,
  getQrSheet,
  getQuestionsByTopic,
  getNextUnanswered,
  getNextTopicForReader,
  reorder,
  makeCreate,
  makeUpdate,
  makeDelete,
};
