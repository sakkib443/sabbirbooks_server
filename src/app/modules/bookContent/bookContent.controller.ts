/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { publicBaseUrl } from '../../utils/publicBaseUrl';
import { PROTECTED_MEDIA_DIR } from '../../config/localUpload';
import { BookContentService } from './bookContent.service';
import { verifyMediaToken, withMediaTokens } from './mediaToken';

// Small table rather than a `mime` dependency: these are the only extensions
// the uploader accepts, and a wrong Content-Type here means a video that will
// not play.
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  csv: 'text/csv',
  txt: 'text/plain',
};

const mime = (fileName: string): string =>
  MIME_BY_EXT[(fileName.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

/** userId from a normal access token, or null. Mirrors authMiddleware's verify. */
const verifyBearerUserId = (token: string): string | null => {
  try {
    const decoded = jwt.verify(token, config.jwt.access_secret) as { _id?: string };
    return decoded?._id ? String(decoded._id) : null;
  } catch {
    return null;
  }
};

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

    if (!result.ok && result.reason === 'awaiting_delivery') {
      return res.status(403).json({
        success: false,
        message: 'Your book has not been delivered yet',
        code: 'BOOK_AWAITING_DELIVERY',
        book: result.book,
      });
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
 * The body both upload routes answer with.
 *
 * Shared so the two cannot drift: the admin pickers read `fileUrl` and `size`,
 * and a field present on one route but missing from its twin is a form that
 * breaks for one kind of asset only — the sort of thing nobody notices until a
 * client reports it.
 */
const describeUpload = (file: any, fileUrl: string) => {
  const originalName = file.originalname || 'file';
  const ext = (originalName.split('.').pop() || '').toLowerCase();
  const isVideo = /^(mp4|webm|mov|mkv|avi)$/.test(ext);

  return {
    fileUrl,
    fileName: originalName,
    fileType: ext,
    size: file.size,
    kind: isVideo ? 'video' : /^(png|jpe?g|webp|gif|svg)$/.test(ext) ? 'image' : 'document',
  };
};

/**
 * POST /api/book-content/upload — PDFs, images and short answer videos.
 *
 * Files land on local disk (Cloudinary is not configured) under
 * <cwd>/uploads/protected and leave again only through the access-checked media
 * route below. In the container that path is the mounted volume, so uploads
 * survive a redeploy — without it every answer's PDF would vanish on the next
 * push.
 */
const uploadFile = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const base = publicBaseUrl(req);
    // Points at the access-checked route, not the static /uploads mount —
    // these files are paid content and the static mount has no auth.
    const fileUrl = file.filename
      ? `${base}/api/book-content/media/${file.filename}`
      : file.path || file.secure_url || file.url;

    res.status(200).json({ success: true, data: describeUpload(file, fileUrl) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/book-content/upload-public — cover art, preview pages, sample PDFs.
 *
 * Twin of uploadFile, kept separate on purpose. Everything here is marketing:
 * the storefront, the homepage and Facebook's link-preview crawler all fetch it
 * with no token at all, so a cover stored behind the media route answers them
 * with 401 and renders as a broken image for exactly the visitors it exists to
 * attract. Landing in uploads/materials — the one directory app.ts serves
 * statically — is what makes that work.
 *
 * Nothing attached to an ANSWER may be uploaded here: that is uploadFile's job,
 * and the split is the whole reason paid figures stay paid.
 */
const uploadPublicFile = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const base = publicBaseUrl(req);
    const fileUrl = file.filename
      ? `${base}/uploads/materials/${file.filename}`
      : file.path || file.secure_url || file.url;

    res.status(200).json({ success: true, data: describeUpload(file, fileUrl) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/book-content/media/:fileName — access-checked answer media.
 *
 * Replaces the old world-readable /uploads/materials/* path for anything
 * attached to a book answer. Streams rather than res.sendFile so a Range
 * request works: without it a phone cannot seek inside an answer video.
 */
const serveProtectedMedia = async (req: Request, res: Response) => {
  try {
    // Two ways in, because an <img>/<video> tag can only carry a query string:
    //   ?t=<media token>  — normal path, stamped onto the URL by the API
    //   Bearer header     — for a direct/programmatic fetch
    const queryToken = typeof req.query.t === 'string' ? req.query.t : null;
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;

    const userId =
      (queryToken && verifyMediaToken(queryToken)) ||
      (bearer ? verifyBearerUserId(bearer) : null);

    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized access' });

    // path.basename strips any ../ before it can escape the directory; the
    // whitelist then rejects anything multer would never have written.
    const fileName = path.basename(req.params.fileName || '');
    if (!fileName || !/^[A-Za-z0-9._-]+$/.test(fileName)) {
      return res.status(400).json({ success: false, message: 'Bad file name' });
    }

    const allowed = await BookContentService.canReadProtectedMedia(fileName, userId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'No access to this file' });
    }

    const filePath = path.join(PROTECTED_MEDIA_DIR, fileName);
    // Resolved and re-checked: symlinks and odd encodings can still land
    // outside the directory even after basename().
    if (!path.resolve(filePath).startsWith(path.resolve(PROTECTED_MEDIA_DIR))) {
      return res.status(400).json({ success: false, message: 'Bad file name' });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const type = mime(fileName);
    // Private: this is per-user authorised content, so no shared cache may keep
    // a copy and hand it to the next person.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    res.setHeader('Content-Length', String(stat.size));
    return fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
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
    // Admin route, but the media still comes through the token-checked route —
    // without stamping, every figure in the editor would 401.
    res.status(200).json({
      success: true,
      data: withMediaTokens(result, String((req as any).user?._id)),
    });
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

/**
 * PATCH /api/book-content/reorder/:level
 *
 * `scopeId` is optional and is the parent the caller believes it is reordering
 * (the topic, for questions). The service rejects a payload that disagrees with
 * it — every validation failure below is a 400 with a readable reason, never a
 * partial write.
 */
const reorder = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.reorder(
      req.params.level,
      req.body?.items,
      req.body?.scopeId
    );
    res.status(200).json({ success: true, message: 'Reordered', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/** PATCH /api/book-content/questions/:id/restore — undo a question delete. */
const restoreQuestion = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.restoreQuestion(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'question not found' });
    res.status(200).json({ success: true, message: 'question restored', data: result });
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

/**
 * GET /api/book-content/outline/:bookIdOrSlug — the public table of contents.
 *
 * 200 with null data for an unknown book rather than 404: the shop renders this
 * inside a page that must not fail, and "this book has no outline" and "no such
 * book" lead to the same (hidden) section.
 */
const getOutline = async (req: Request, res: Response) => {
  try {
    const data = await BookContentService.getOutline(req.params.bookIdOrSlug);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const BookContentController = {
  scan,
  getOutline,
  uploadFile,
  uploadPublicFile,
  serveProtectedMedia,
  getTree,
  getStats,
  getQrSheet,
  getQuestionsByTopic,
  getNextUnanswered,
  getNextTopicForReader,
  reorder,
  restoreQuestion,
  makeCreate,
  makeUpdate,
  makeDelete,
};
