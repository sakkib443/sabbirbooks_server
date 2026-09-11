/* eslint-disable no-console */
/**
 * Strip the media tokens that were saved into question URLs by mistake.
 *
 * The admin editor loads a question through the API, which stamps every
 * figure's URL with a short-lived `?t=…` token so the image can render. On
 * save, the editor sent those URLs back unchanged, and the server stored them
 * token and all. The token expires in thirty minutes; from then on the stored
 * URL is a broken image — for the admin and for every reader who owns the
 * book. Twenty-one questions were saved that way between 28 Aug and 10 Sep.
 *
 * The code no longer stores tokens (sanitizeQuestionPayload strips them on
 * save), but that does not help a row already written: the media route finds a
 * file's owning question by matching the stored URL anchored at its end, and a
 * URL that ends in "?t=…" never matches, so the file is refused no matter what
 * token the reader carries. The rows themselves have to be cleaned — this does
 * it, once. Once clean, they work on the code already deployed.
 *
 * WHAT IT TOUCHES: the URL strings in `images`, `attachments[].fileUrl`,
 * `videos[].url` and `answerHtml`, and only on questions that actually carry a
 * token. Nothing else on the document — not the text, the order, the
 * published flag, the timestamps of anything but the row it rewrites.
 *
 * Dry run by default:
 *   npx ts-node --transpile-only src/scripts/repairMediaTokens.ts
 *   npx ts-node --transpile-only src/scripts/repairMediaTokens.ts --apply
 */
import mongoose from 'mongoose';

const TOKEN = /\?t=/;
const short = (u: string) => u.replace(/\?t=[^\s"'<>\\?&]*/g, (m) => `?t=${m.slice(3, 11)}…`);

(async () => {
  const apply = process.argv.includes('--apply');

  await import('../app/config');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { BookQuestion } = await import('../app/modules/bookContent/bookContent.model');
  const { stripMediaTokens } = await import('../app/modules/bookContent/mediaToken');

  const withImagesBefore = await BookQuestion.countDocuments({ 'images.0': { $exists: true } });

  // Every question, filtered in code rather than by a regex query: the token
  // can sit in four different places and a `$or` of four regexes is easier to
  // get subtly wrong than one predicate.
  const all = await BookQuestion.find({})
    .select('questionNo topicId images attachments videos answerHtml')
    .lean();

  type Fix = { id: unknown; questionNo: string; set: Record<string, unknown>; before: string[]; after: string[] };
  const fixes: Fix[] = [];

  for (const q of all as any[]) {
    const set: Record<string, unknown> = {};
    const before: string[] = [];
    const after: string[] = [];

    const images: string[] = q.images || [];
    if (images.some((u) => TOKEN.test(String(u)))) {
      set.images = images.map((u) => stripMediaTokens(String(u)));
      images.forEach((u, i) => {
        if (TOKEN.test(String(u))) { before.push(`images[${i}] ${short(String(u))}`); after.push(`images[${i}] ${(set.images as string[])[i]}`); }
      });
    }
    const attachments: any[] = q.attachments || [];
    if (attachments.some((a) => TOKEN.test(String(a?.fileUrl || '')))) {
      set.attachments = attachments.map((a) => ({ ...a, fileUrl: stripMediaTokens(String(a?.fileUrl || '')) }));
      attachments.forEach((a, i) => {
        if (TOKEN.test(String(a?.fileUrl || ''))) { before.push(`attachments[${i}] ${short(String(a.fileUrl))}`); after.push(`attachments[${i}] ${(set.attachments as any[])[i].fileUrl}`); }
      });
    }
    const videos: any[] = q.videos || [];
    if (videos.some((v) => TOKEN.test(String(v?.url || '')))) {
      set.videos = videos.map((v) => ({ ...v, url: stripMediaTokens(String(v?.url || '')) }));
      videos.forEach((v, i) => {
        if (TOKEN.test(String(v?.url || ''))) { before.push(`videos[${i}] ${short(String(v.url))}`); after.push(`videos[${i}] ${(set.videos as any[])[i].url}`); }
      });
    }
    const html = String(q.answerHtml || '');
    if (TOKEN.test(html) && html.includes('/api/book-content/media/')) {
      set.answerHtml = stripMediaTokens(html);
      before.push('answerHtml (contains a token)');
      after.push('answerHtml (cleaned)');
    }

    if (Object.keys(set).length) fixes.push({ id: q._id, questionNo: String(q.questionNo), set, before, after });
  }

  console.log(apply ? '\n── APPLYING ──\n' : '\n── DRY RUN ──\n');
  console.log(`Questions with a stored token: ${fixes.length}`);
  console.log(`Questions with images (must not change): ${withImagesBefore}\n`);

  for (const f of fixes) {
    console.log(`#${f.questionNo}  ${String(f.id)}`);
    f.before.forEach((b, i) => {
      console.log(`   - ${b}`);
      console.log(`   + ${f.after[i]}`);
    });
  }

  if (!apply) {
    console.log('\n── Nothing written. Re-run with --apply to commit. ──\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  let modified = 0;
  for (const f of fixes) {
    const res = await BookQuestion.updateOne({ _id: f.id }, { $set: f.set });
    modified += res.modifiedCount || 0;
  }

  // Prove it rather than promise it: no token anywhere, and not one question
  // lost an image on the way.
  const remaining = (await BookQuestion.find({}).select('images attachments videos answerHtml').lean()).filter((q: any) =>
    (q.images || []).some((u: string) => TOKEN.test(String(u))) ||
    (q.attachments || []).some((a: any) => TOKEN.test(String(a?.fileUrl || ''))) ||
    (q.videos || []).some((v: any) => TOKEN.test(String(v?.url || ''))) ||
    (TOKEN.test(String(q.answerHtml || '')) && String(q.answerHtml || '').includes('/api/book-content/media/'))
  ).length;
  const withImagesAfter = await BookQuestion.countDocuments({ 'images.0': { $exists: true } });

  console.log(`\n✅ ${modified} question(s) rewritten.`);
  console.log(`   tokens remaining        : ${remaining}${remaining === 0 ? ' ✅' : ' ❌'}`);
  console.log(`   questions with images   : ${withImagesBefore} → ${withImagesAfter}${withImagesAfter === withImagesBefore ? ' ✅ unchanged' : ' ❌ CHANGED'}`);

  await mongoose.disconnect();
  process.exit(remaining === 0 && withImagesAfter === withImagesBefore ? 0 : 1);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
