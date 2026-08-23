/* eslint-disable no-console */
/**
 * Move book answer media out of the world-readable /uploads mount.
 *
 * Answer figures, videos and PDFs used to sit under uploads/materials, which
 * app.ts serves with express.static and no auth. This walks every BookQuestion,
 * moves each referenced file into uploads/protected, and rewrites the stored
 * URL to the access-checked route.
 *
 * Lives under app/ rather than scripts/ because server.ts runs it at boot, and
 * scripts/ is excluded from BOTH tsconfig and the Docker image — importing it
 * from server.ts compiled locally but broke the production build.
 *
 * Idempotent, and only rewrites a URL whose file it can actually see, so a run
 * without the media volume attached is a no-op rather than mass breakage.
 */
import fs from 'fs';
import path from 'path';
import { BookQuestion } from '../modules/bookContent/bookContent.model';
import { PROTECTED_MEDIA_DIR } from '../config/localUpload';

const MATERIALS_DIR = path.join(process.cwd(), 'uploads', 'materials');
// Must run where the volume is mounted (inside the container), not on a laptop
// — the DB rows would be rewritten while the files stayed behind on the server.
const MEDIA_PATH = '/api/book-content/media/';

type Plan = {
  questionId: string;
  field: string;
  from: string;
  to: string;
  fileName: string;
  fileFound: boolean;
  needsMove: boolean;
};

// Stored URLs carry two different origins — an old *.sslip.io backend host and
// the current site — so the origin is normalised rather than preserved. The
// site proxies /api/* to the backend, so this one origin works for both.
const NEW_ORIGIN = (process.env.MEDIA_ORIGIN || 'https://magicviva.com').replace(/\/+$/, '');

/** Rewrites a legacy /uploads/materials/<name> URL, or returns null to skip. */
const rewrite = (url: string): { to: string; fileName: string } | null => {
  if (!url || url.includes(MEDIA_PATH)) return null; // already migrated
  const match = /\/uploads\/materials\/([^/?#]+)/.exec(url);
  if (!match) return null; // external (YouTube etc.) — leave alone
  const fileName = decodeURIComponent(match[1]);
  return { to: `${NEW_ORIGIN}${MEDIA_PATH}${fileName}`, fileName };
};

// verbose is off for the boot-time call: 1400+ per-file lines would bury the
// startup log every single deploy, long after the migration stopped doing work.
export const migrateAnswerMedia = async (apply: boolean, verbose = false) => {
  const questions = await BookQuestion.find({})
    .select('_id videos attachments images')
    .lean();

  const plans: Plan[] = [];

  for (const q of questions) {
    const consider = (url: string | undefined, field: string) => {
      if (!url) return;
      const r = rewrite(url);
      if (!r) return;
      // "Found" means the bytes are reachable — still in materials/, or already
      // moved by an earlier run. A URL whose file is in neither place is left
      // untouched: rewriting it would point the reader at a 404, and would also
      // make a later run on the machine that DOES have the file skip it as
      // "already migrated". That is the failure mode that would silently break
      // all 1400+ figures if this were ever run somewhere without the volume.
      const inMaterials = fs.existsSync(path.join(MATERIALS_DIR, r.fileName));
      const inProtected = fs.existsSync(path.join(PROTECTED_MEDIA_DIR, r.fileName));
      plans.push({
        questionId: String(q._id),
        field,
        from: url,
        to: r.to,
        fileName: r.fileName,
        fileFound: inMaterials || inProtected,
        needsMove: inMaterials && !inProtected,
      });
    };

    (q.videos || []).forEach((v, i) => consider(v?.url, `videos.${i}.url`));
    (q.attachments || []).forEach((a, i) => consider(a?.fileUrl, `attachments.${i}.fileUrl`));
    (q.images || []).forEach((src, i) => consider(src, `images.${i}`));
  }

  if (verbose) {
    console.log(`\n${plans.length} media reference(s) to migrate\n`);
    for (const p of plans) {
      console.log(`  ${p.fileFound ? '✓' : '⚠ file missing on disk:'} ${p.fileName}`);
      console.log(`      ${p.field} of question ${p.questionId}`);
    }
  }

  const actionable = plans.filter(p => p.fileFound);
  const missing = plans.filter(p => !p.fileFound);
  if (missing.length && verbose) {
    console.log(
      `\n⚠  ${missing.length} reference(s) point at a file present in neither uploads/materials` +
        `\n   nor uploads/protected. They are SKIPPED, not rewritten — most likely this is` +
        `\n   running somewhere without the media volume attached. Run it where the volume is.`
    );
  }

  if (!apply) {
    console.log(
      `\nDry run — nothing changed. Would move ${
        actionable.filter(p => p.needsMove).length
      } file(s) and rewrite ${actionable.length} URL(s). Re-run with --apply to commit.`
    );
    return { planned: plans.length, moved: 0, rewritten: 0, skipped: missing.length };
  }

  // Move files first. A moved file with a stale URL still serves (the fallback
  // is the old public path); a rewritten URL with an unmoved file is a 404 for
  // every reader — so if the process dies midway, this order fails quieter.
  let moved = 0;
  const uniqueFiles = [...new Set(actionable.filter(p => p.needsMove).map(p => p.fileName))];
  for (const fileName of uniqueFiles) {
    const from = path.join(MATERIALS_DIR, fileName);
    const to = path.join(PROTECTED_MEDIA_DIR, fileName);
    if (fs.existsSync(to)) continue;
    fs.renameSync(from, to);
    moved++;
  }

  let rewritten = 0;
  const byQuestion = new Map<string, Plan[]>();
  for (const p of actionable) {
    byQuestion.set(p.questionId, [...(byQuestion.get(p.questionId) || []), p]);
  }
  for (const [questionId, items] of byQuestion) {
    const $set: Record<string, string> = {};
    for (const i of items) $set[i.field] = i.to;
    await BookQuestion.updateOne({ _id: questionId }, { $set });
    rewritten += items.length;
  }

  return { planned: plans.length, moved, rewritten, skipped: missing.length };
};
