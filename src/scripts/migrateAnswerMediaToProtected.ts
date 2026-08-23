/* eslint-disable no-console */
/**
 * Move book answer media out of the world-readable /uploads mount.
 *
 * Until now every answer figure, video and PDF sat under uploads/materials,
 * which app.ts serves with express.static and no auth — anyone holding or
 * guessing a filename could pull paid artwork without an account. This walks
 * every BookQuestion, moves each referenced file into protected-media/, and
 * rewrites the stored URL to the access-checked route.
 *
 * Idempotent and safe to re-run: a URL already pointing at the media route is
 * left alone, and a file already moved is not moved twice.
 *
 * DRY RUN FIRST — it prints exactly what it would do and changes nothing:
 *   npx ts-node src/scripts/migrateAnswerMediaToProtected.ts
 * Then commit:
 *   npx ts-node src/scripts/migrateAnswerMediaToProtected.ts --apply
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { BookQuestion } from '../app/modules/bookContent/bookContent.model';
import { PROTECTED_MEDIA_DIR } from '../app/config/localUpload';

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
};

/** Rewrites a legacy /uploads/materials/<name> URL, or returns null to skip. */
const rewrite = (url: string): { to: string; fileName: string } | null => {
  if (!url || url.includes(MEDIA_PATH)) return null; // already migrated
  const match = /\/uploads\/materials\/([^/?#]+)/.exec(url);
  if (!match) return null; // external (YouTube etc.) — leave alone
  const fileName = decodeURIComponent(match[1]);
  const origin = url.split('/uploads/')[0];
  return { to: `${origin}${MEDIA_PATH}${fileName}`, fileName };
};

export const migrateAnswerMedia = async (apply: boolean) => {
  const questions = await BookQuestion.find({})
    .select('_id videos attachments images')
    .lean();

  const plans: Plan[] = [];

  for (const q of questions) {
    const consider = (url: string | undefined, field: string) => {
      if (!url) return;
      const r = rewrite(url);
      if (!r) return;
      plans.push({
        questionId: String(q._id),
        field,
        from: url,
        to: r.to,
        fileName: r.fileName,
        fileFound: fs.existsSync(path.join(MATERIALS_DIR, r.fileName)),
      });
    };

    (q.videos || []).forEach((v, i) => consider(v?.url, `videos.${i}.url`));
    (q.attachments || []).forEach((a, i) => consider(a?.fileUrl, `attachments.${i}.fileUrl`));
    (q.images || []).forEach((src, i) => consider(src, `images.${i}`));
  }

  console.log(`\n${plans.length} media reference(s) to migrate\n`);
  for (const p of plans) {
    console.log(`  ${p.fileFound ? '✓' : '⚠ file missing on disk:'} ${p.fileName}`);
    console.log(`      ${p.field} of question ${p.questionId}`);
  }

  const missing = plans.filter(p => !p.fileFound);
  if (missing.length) {
    console.log(
      `\n⚠  ${missing.length} reference(s) point at a file that is not in uploads/materials.` +
        `\n   The URL will still be rewritten — if the file was already moved by an earlier` +
        `\n   run this is expected; otherwise that media was already broken.`
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to commit.');
    return { planned: plans.length, moved: 0, rewritten: 0 };
  }

  // Move files first. A moved file with a stale URL is invisible; a rewritten
  // URL with an unmoved file is a 404 for every reader — so if the process dies
  // between the two, this order fails in the quieter direction.
  let moved = 0;
  const uniqueFiles = [...new Set(plans.filter(p => p.fileFound).map(p => p.fileName))];
  for (const fileName of uniqueFiles) {
    const from = path.join(MATERIALS_DIR, fileName);
    const to = path.join(PROTECTED_MEDIA_DIR, fileName);
    if (fs.existsSync(to)) continue;
    fs.renameSync(from, to);
    moved++;
  }

  let rewritten = 0;
  const byQuestion = new Map<string, Plan[]>();
  for (const p of plans) {
    byQuestion.set(p.questionId, [...(byQuestion.get(p.questionId) || []), p]);
  }
  for (const [questionId, items] of byQuestion) {
    const $set: Record<string, string> = {};
    for (const i of items) $set[i.field] = i.to;
    await BookQuestion.updateOne({ _id: questionId }, { $set });
    rewritten += items.length;
  }

  return { planned: plans.length, moved, rewritten };
};

if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    await import('../app/config');
    const { dbConnect } = await import('../app/utils/dbConnect');
    await dbConnect();
    console.log(apply ? '── APPLYING ──' : '── DRY RUN ──');
    const res = await migrateAnswerMedia(apply);
    console.log(
      `\n✅ ${res.planned} planned, ${res.moved} file(s) moved, ${res.rewritten} URL(s) rewritten.`
    );
    await mongoose.disconnect();
    process.exit(0);
  })().catch(e => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  });
}
