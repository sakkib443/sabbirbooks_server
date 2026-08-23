/* eslint-disable no-console */
/**
 * Sanitise answerHtml that was stored before sanitising existed.
 *
 * Sanitising on write only protects new content; anything already saved is
 * still rendered raw into the reader page. This rewrites the stored documents
 * so the whole corpus is safe.
 *
 * DRY RUN FIRST — prints a diff summary and changes nothing:
 *   npx ts-node src/scripts/sanitizeExistingAnswers.ts
 * Then:
 *   npx ts-node src/scripts/sanitizeExistingAnswers.ts --apply
 */
import mongoose from 'mongoose';
import { BookQuestion } from '../app/modules/bookContent/bookContent.model';
import { sanitizeAnswerHtml } from '../app/modules/bookContent/sanitizeAnswer';

// Worth calling out individually in the report — these are the ones that would
// have executed, as opposed to a cosmetic attribute drop.
const DANGEROUS = /<script|<iframe|<object|<embed|javascript:|\son\w+\s*=/i;

export const sanitizeExistingAnswers = async (apply: boolean) => {
  const questions = await BookQuestion.find({
    answerHtml: { $exists: true, $nin: [null, ''] },
  })
    .select('_id questionNo answerHtml')
    .lean();

  const changed: { id: string; questionNo: string; before: number; after: number; risky: boolean }[] =
    [];

  for (const q of questions) {
    const before = q.answerHtml || '';
    const after = sanitizeAnswerHtml(before) ?? '';
    if (after === before) continue;
    changed.push({
      id: String(q._id),
      questionNo: q.questionNo,
      before: before.length,
      after: after.length,
      risky: DANGEROUS.test(before),
    });
    if (apply) await BookQuestion.updateOne({ _id: q._id }, { $set: { answerHtml: after } });
  }

  const risky = changed.filter(c => c.risky);
  console.log(`\nScanned ${questions.length} answer(s); ${changed.length} would change.`);

  if (risky.length) {
    console.log(`\n🚨 ${risky.length} contained executable markup:`);
    risky.forEach(c => console.log(`   question ${c.questionNo} (${c.id})`));
  } else {
    console.log('\n✓ No executable markup found — remaining changes are cosmetic.');
  }

  // A large shrink usually means the allowlist ate something legitimate, so it
  // is surfaced rather than left for someone to notice on the reader page.
  const bigDrops = changed.filter(c => c.after < c.before * 0.8);
  if (bigDrops.length) {
    console.log(`\n⚠  ${bigDrops.length} answer(s) shrank by more than 20% — review these:`);
    bigDrops
      .slice(0, 20)
      .forEach(c => console.log(`   question ${c.questionNo}: ${c.before} → ${c.after} chars`));
  }

  if (!apply) console.log('\nDry run — nothing written. Re-run with --apply to commit.');
  return { scanned: questions.length, changed: changed.length, risky: risky.length };
};

if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    await import('../app/config');
    const { dbConnect } = await import('../app/utils/dbConnect');
    await dbConnect();
    console.log(apply ? '── APPLYING ──' : '── DRY RUN ──');
    const res = await sanitizeExistingAnswers(apply);
    console.log(
      `\n✅ ${res.scanned} scanned, ${res.changed} ${apply ? 'rewritten' : 'would change'}, ${
        res.risky
      } had executable markup.`
    );
    await mongoose.disconnect();
    process.exit(0);
  })().catch(e => {
    console.error('❌ Failed:', e);
    process.exit(1);
  });
}
