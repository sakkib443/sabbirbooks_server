/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import config from '../../config';
import { publicBaseUrl } from '../../utils/publicBaseUrl';
import { MATERIALS_DIR, PROTECTED_MEDIA_DIR } from '../../config/localUpload';
import { BookContentService } from './bookContent.service';
import { signMediaToken, verifyMediaToken, withMediaTokens } from './mediaToken';
import { ensureVariant, makeVariants, variantOf } from './mediaVariants';
import { ensureTopicBundle, topicPdfs, type TopicPdf } from './topicPdfBundle';
import { BookTopic } from './bookContent.model';

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

/** The reader behind a media request: ?t= media token, or a Bearer header. */
const mediaReader = (req: Request): string | null => {
  const queryToken = typeof req.query.t === 'string' ? req.query.t : null;
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return (queryToken && verifyMediaToken(queryToken)) || (bearer ? verifyBearerUserId(bearer) : null);
};

/**
 * A Content-Disposition that makes the phone SAVE the file, under a readable
 * name, instead of opening it in a tab.
 *
 * Opening was the trouble: Android Chrome shows a PDF in a tab only once the
 * whole file has arrived, so a student tapping "download" on a large answer PDF
 * stared at a blank grey page with no progress at all — and if the network
 * stalled, stared at it for good. "attachment" hands the file to the phone's
 * download manager instead, which shows progress in the notification bar,
 * keeps going in the background and leaves the file in Downloads.
 *
 * filename* carries the real (often Bengali) name; filename is the plain-ASCII
 * fallback older browsers read.
 */
export const attachmentHeader = (wanted: string, ext: string): string => {
  let name = (wanted || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();
  if (!name) name = 'magic-viva';
  const dotExt = ext ? `.${ext.toLowerCase()}` : '';
  if (dotExt && !name.toLowerCase().endsWith(dotExt)) name += dotExt;
  const ascii = /^[\x20-\x7e]+$/.test(name) ? name : `magic-viva${dotExt}`;
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

/**
 * Streams a stored file with the caching and Range support every reader needs.
 * Range is what lets a phone seek inside a video, the PDF viewer fetch one page
 * at a time, and a download manager resume after the signal drops.
 */
const sendStoredFile = (
  req: Request,
  res: Response,
  filePath: string,
  opts: { type: string; disposition?: string }
) => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).json({ success: false, message: 'File not found' });
  }

  // Private: this is per-user authorised content, so no shared cache may keep
  // a copy and hand it to the next person.
  //
  // A file here never changes once written — every upload gets its own name —
  // so the browser is told it may keep it for a day, and the ETag lets it ask
  // "still the same?" in one cheap round trip after that.
  const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  // A download is always sent whole: a 304 there would leave the download
  // manager with nothing to save.
  if (!opts.disposition && req.headers['if-none-match'] === etag) {
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(304).end();
  }
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Type', opts.type);
  res.setHeader('Accept-Ranges', 'bytes');
  if (opts.disposition) res.setHeader('Content-Disposition', opts.disposition);

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
    // May be undefined: a free chapter's QR is answered for anyone. The service
    // decides — it is the only place that knows whether this topic's chapter is
    // free, and a stranger must reach it for that decision to happen.
    const userId = (req as any).user?._id;

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

    // The small copies the reader actually shows, made now so the first
    // student to open the answer is not the one who waits for them. The
    // original is untouched and the answer stores its URL, as before.
    if (file.filename) await makeVariants(PROTECTED_MEDIA_DIR, file.filename);

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

    // A cover is shown a few hundred pixels wide and was going out as a
    // print-resolution PNG. The small copies go up beside it, under the same
    // static mount; the URL stored on the book does not change.
    if (file.filename) await makeVariants(MATERIALS_DIR, file.filename);

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
    const userId = mediaReader(req);

    // No 401 here any more: a free chapter's media is readable without a
    // reader, and only canReadProtectedMedia knows whether this file belongs to
    // one. Refusing first would break every figure on the free chapter's page.

    // path.basename strips any ../ before it can escape the directory; the
    // whitelist then rejects anything multer would never have written.
    const fileName = path.basename(req.params.fileName || '');
    if (!fileName || !/^[A-Za-z0-9._-]+$/.test(fileName)) {
      return res.status(400).json({ success: false, message: 'Bad file name' });
    }

    // A request for a small copy is a request for the picture it was made
    // from: the answer stores the original's name, and that is the name the
    // access check knows. See mediaVariants.
    const variant = variantOf(fileName);
    const accessName = variant ? variant.origin : fileName;

    const allowed = await BookContentService.canReadProtectedMedia(accessName, userId);
    if (!allowed) {
      // 401 for a caller we could not identify — their media token has very
      // likely just expired, and the page should send them to sign in rather
      // than tell them they do not own a book they may well have bought. 403
      // for one we could identify: this file is genuinely not theirs.
      const code = userId ? 403 : 401;
      return res.status(code).json({ success: false, message: 'No access to this file' });
    }

    let filePath = path.join(PROTECTED_MEDIA_DIR, accessName);
    // Resolved and re-checked: symlinks and odd encodings can still land
    // outside the directory even after basename().
    if (!path.resolve(filePath).startsWith(path.resolve(PROTECTED_MEDIA_DIR))) {
      return res.status(400).json({ success: false, message: 'Bad file name' });
    }

    // Made on the first request when it is not there yet, which is how every
    // figure uploaded before this existed gets its small copies. If it cannot
    // be made, the original answers — a heavy figure beats a missing one.
    if (variant) {
      const made = await ensureVariant(PROTECTED_MEDIA_DIR, variant.origin, variant.kind);
      if (made) filePath = made;
    }

    // ?download=1 — save it rather than open it (see attachmentHeader), under
    // ?name= (the attachment's title) or, failing that, the stored name
    // without its upload-time prefix.
    const disposition =
      req.query.download === '1'
        ? attachmentHeader(
            typeof req.query.name === 'string' && req.query.name.trim()
              ? req.query.name
              : accessName.replace(/^\d{10,}-/, ''),
            path.extname(filePath).slice(1)
          )
        : undefined;

    return sendStoredFile(req, res, filePath, { type: mime(path.basename(filePath)), disposition });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

type TopicPdfAccess =
  | { ok: true; topicId: string; title: string; pdfs: TopicPdf[] }
  | { ok: false; status: number; message: string };

/**
 * A topic's PDFs, if this reader may have every one of them. Each file goes
 * through canReadProtectedMedia — the media route's own check — so the merged
 * file can never hand out a page its source would have refused.
 */
const resolveTopicPdfs = async (topicId: string, userId: string | null): Promise<TopicPdfAccess> => {
  if (!/^[a-f0-9]{24}$/i.test(topicId)) return { ok: false, status: 404, message: 'Topic not found' };
  const topic = await BookTopic.findOne({ _id: topicId, isDeleted: false, isPublished: true })
    .select('title topicNo')
    .lean();
  if (!topic) return { ok: false, status: 404, message: 'Topic not found' };

  const pdfs = await topicPdfs(topicId);
  if (!pdfs.length) return { ok: false, status: 404, message: 'এই টপিকে কোনো PDF নেই' };

  for (const p of pdfs) {
    if (!(await BookContentService.canReadProtectedMedia(p.fileName, userId))) {
      // Same split as the media route: 401 = sign in again, 403 = not theirs.
      return { ok: false, status: userId ? 403 : 401, message: 'No access to these files' };
    }
  }
  const t = topic as { topicNo?: string; title?: string };
  const title = `${t.topicNo ? `${t.topicNo}. ` : ''}${t.title || 'Topic'}`.trim();
  return { ok: true, topicId, title, pdfs };
};

/** Query string for a download link: the reader's media token, if any, and the name to save under. */
const downloadQuery = (userId: string | null, name?: string) => {
  const q = new URLSearchParams();
  if (userId) q.set('t', signMediaToken(userId));
  q.set('download', '1');
  if (name) q.set('name', name);
  return q.toString();
};

/**
 * GET /api/book-content/topic-pdfs/:topicId — gets "download all" ready.
 *
 * Builds (or finds) the topic's merged PDF and answers with the link to fetch
 * it, plus what went in and what could not. Two steps rather than one link so
 * the page can say "preparing…" while the first student's request builds it,
 * and can name any PDF that has to be downloaded on its own. A topic with a
 * single PDF needs no merging: the link is to that file.
 */
const prepareTopicPdfs = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id ? String((req as any).user._id) : null;
    const found = await resolveTopicPdfs(req.params.topicId, userId);
    if (!found.ok) return res.status(found.status).json({ success: false, message: found.message });

    if (found.pdfs.length === 1) {
      const only = found.pdfs[0];
      return res.status(200).json({
        success: true,
        data: {
          url: `/api/book-content/media/${only.fileName}?${downloadQuery(userId, only.title)}`,
          count: 1,
          included: [only.title],
          skipped: [],
        },
      });
    }

    const bundle = await ensureTopicBundle(found.topicId, found.title, found.pdfs);
    if (!bundle) {
      return res.status(422).json({
        success: false,
        message: 'PDF গুলো একসাথে করা গেল না — নিচ থেকে একটা একটা করে ডাউনলোড করুন',
      });
    }
    return res.status(200).json({
      success: true,
      data: {
        url: `/api/book-content/topic-pdfs/${found.topicId}/file?${downloadQuery(userId)}`,
        count: bundle.included.length,
        pages: bundle.pages,
        size: bundle.size,
        included: bundle.included,
        skipped: bundle.skipped,
      },
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/book-content/topic-pdfs/:topicId/file — the merged PDF itself.
 *
 * Reached by plain navigation (the phone's download manager cannot send a
 * header), so it takes the ?t= media token like the media route does, and
 * re-checks access file by file. Always sent as an attachment, with Range, so a
 * download that drops can resume where it stopped.
 */
const serveTopicPdfs = async (req: Request, res: Response) => {
  try {
    const userId = mediaReader(req);
    const found = await resolveTopicPdfs(req.params.topicId, userId);
    if (!found.ok) return res.status(found.status).json({ success: false, message: found.message });

    const disposition = attachmentHeader(`${found.title} - all PDFs`, 'pdf');
    if (found.pdfs.length === 1) {
      const only = path.join(PROTECTED_MEDIA_DIR, found.pdfs[0].fileName);
      return sendStoredFile(req, res, only, { type: 'application/pdf', disposition });
    }
    const bundle = await ensureTopicBundle(found.topicId, found.title, found.pdfs);
    if (!bundle) return res.status(422).json({ success: false, message: 'Could not combine these PDFs' });
    return sendStoredFile(req, res, bundle.path, { type: 'application/pdf', disposition });
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

const getVideoNotes = async (req: Request, res: Response) => {
  try {
    const result = await BookContentService.getVideoNotes(req.params.bookId);
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
  prepareTopicPdfs,
  serveTopicPdfs,
  getTree,
  getStats,
  getQrSheet,
  getQuestionsByTopic,
  getVideoNotes,
  getNextUnanswered,
  getNextTopicForReader,
  reorder,
  restoreQuestion,
  makeCreate,
  makeUpdate,
  makeDelete,
};
