/**
 * Every PDF in a topic, as ONE file — the reader's "download all" button.
 *
 * A topic's PDFs hang off its questions, one or two per question. On a phone,
 * fetching them one at a time meant a tap, a wait and a trip back for each, and
 * students asked for the lot in one go. One merged PDF opens in any reader the
 * phone already has, which a ZIP of them would not.
 *
 * The merged file is cached on disk, under the protected volume, named after
 * the topic and a hash of its sources (name, size, modified time). So it is
 * built once — by the first student to ask — and every student after that gets
 * the same file straight off the disk. When an admin adds, replaces or removes
 * a PDF, the hash changes and the next request builds a fresh one; the stale
 * copy is deleted then.
 *
 * pdf-lib copies pages as they are (no re-rendering, no recompression), so a
 * scanned page loses nothing. A PDF it cannot read, or one that is encrypted —
 * its pages would copy over as noise — is left out and named in `skipped`, so
 * the page can say which ones to download separately. Every source file is
 * still served on its own, unchanged.
 *
 * Nothing is written to the database. Access is decided by the caller, file by
 * file, with the same check the media route uses.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { PROTECTED_MEDIA_DIR } from '../../config/localUpload';
import { BookQuestion } from './bookContent.model';

/** Under the protected volume — and in a sub-directory the media route cannot reach. */
export const BUNDLE_DIR = path.join(PROTECTED_MEDIA_DIR, 'bundles');

/** Bump to rebuild every cached bundle (e.g. if the merge itself changes). */
const BUNDLE_VERSION = 1;

export type TopicPdf = { title: string; fileName: string };

export type TopicBundle = {
  path: string;
  pages: number;
  size: number;
  included: string[];
  skipped: string[];
};

const MEDIA_FILE_RE = /\/api\/book-content\/media\/([A-Za-z0-9._-]+)/;

/** "…/api/book-content/media/123-x.pdf?t=…" → "123-x.pdf"; anything else → null. */
export const mediaFileName = (url: string | undefined): string | null => {
  const m = MEDIA_FILE_RE.exec(url || '');
  return m ? m[1] : null;
};

/**
 * The topic's PDFs in reading order: question by question, and within a
 * question in the order they were attached. Only files that live behind the
 * media route and are actually on disk.
 */
export async function topicPdfs(topicId: string): Promise<TopicPdf[]> {
  const questions = await BookQuestion.find({ topicId, isDeleted: false, isPublished: true })
    .sort({ order: 1 })
    .select('attachments')
    .lean();

  const seen = new Set<string>();
  const out: TopicPdf[] = [];
  for (const q of questions) {
    for (const a of (q as { attachments?: { title?: string; fileUrl?: string; fileType?: string }[] }).attachments || []) {
      const fileName = mediaFileName(a.fileUrl);
      if (!fileName || seen.has(fileName)) continue;
      const isPdf = /\.pdf$/i.test(fileName) || (a.fileType || '').toLowerCase() === 'pdf';
      if (!isPdf || !fs.existsSync(path.join(PROTECTED_MEDIA_DIR, fileName))) continue;
      seen.add(fileName);
      out.push({ title: (a.title || fileName).trim(), fileName });
    }
  }
  return out;
}

/** One build at a time across the server, and never the same bundle twice at once. */
const inFlight = new Map<string, Promise<TopicBundle | null>>();
let queue: Promise<unknown> = Promise.resolve();

const build = async (
  base: string,
  topicId: string,
  topicTitle: string,
  pdfs: TopicPdf[]
): Promise<TopicBundle | null> => {
  const merged = await PDFDocument.create();
  const included: string[] = [];
  const skipped: string[] = [];

  for (const p of pdfs) {
    try {
      const bytes = await fs.promises.readFile(path.join(PROTECTED_MEDIA_DIR, p.fileName));
      const doc = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
        throwOnInvalidObject: false,
      });
      // pdf-lib cannot decrypt: the pages of an encrypted file would come
      // across as unreadable noise. Leave it out; it still downloads alone.
      if (doc.isEncrypted) throw new Error('encrypted');
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
      included.push(p.title);
    } catch {
      skipped.push(p.title);
    }
  }
  if (!included.length) return null;

  merged.setTitle(topicTitle);
  merged.setProducer('Magic Viva');
  const bytes = await merged.save();

  fs.mkdirSync(BUNDLE_DIR, { recursive: true });
  const pdfPath = path.join(BUNDLE_DIR, `${base}.pdf`);
  // Temporary name first: a student arriving mid-write must never be handed
  // half a file, which their phone would then keep as if it were whole.
  const temp = `${pdfPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(temp, bytes);
  await fs.promises.rename(temp, pdfPath);

  const bundle: TopicBundle = {
    path: pdfPath,
    pages: merged.getPageCount(),
    size: bytes.length,
    included,
    skipped,
  };
  await fs.promises.writeFile(path.join(BUNDLE_DIR, `${base}.json`), JSON.stringify(bundle));

  // The topic's older bundles, made before its PDFs last changed.
  for (const name of await fs.promises.readdir(BUNDLE_DIR)) {
    if (name.startsWith(`${topicId}-`) && !name.startsWith(base)) {
      await fs.promises.unlink(path.join(BUNDLE_DIR, name)).catch(() => undefined);
    }
  }
  return bundle;
};

/**
 * The topic's merged PDF, built if it is missing or out of date.
 * Null when not one of its PDFs could be read.
 */
export async function ensureTopicBundle(
  topicId: string,
  topicTitle: string,
  pdfs: TopicPdf[]
): Promise<TopicBundle | null> {
  const fingerprint = pdfs.map((p) => {
    const st = fs.statSync(path.join(PROTECTED_MEDIA_DIR, p.fileName));
    return `${p.fileName}:${st.size}:${Math.round(st.mtimeMs)}:${p.title}`;
  });
  const hash = crypto
    .createHash('sha1')
    .update([BUNDLE_VERSION, topicTitle, ...fingerprint].join('|'))
    .digest('hex')
    .slice(0, 16);
  const base = `${topicId}-${hash}`;

  const metaPath = path.join(BUNDLE_DIR, `${base}.json`);
  const pdfPath = path.join(BUNDLE_DIR, `${base}.pdf`);
  if (fs.existsSync(metaPath) && fs.existsSync(pdfPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as TopicBundle;
    } catch {
      /* unreadable meta: rebuild below */
    }
  }

  if (!inFlight.has(base)) {
    const run = queue.then(() => build(base, topicId, topicTitle, pdfs));
    // The queue chains on completion, not on the result, so one bad topic
    // does not stop the ones behind it.
    queue = run.catch(() => undefined);
    inFlight.set(
      base,
      run.catch(() => null).finally(() => inFlight.delete(base))
    );
  }
  return inFlight.get(base)!;
}
