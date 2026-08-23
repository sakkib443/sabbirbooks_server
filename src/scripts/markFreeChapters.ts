/* eslint-disable no-console */
/**
 * Mark specific chapters as isFree so any signed-in visitor can preview them
 * without owning the book.
 *
 * Idempotent — running twice is a no-op. Adjust FREE_CHAPTERS below to change
 * what is free; on the next run new entries flip on and removed entries flip
 * OFF (they lose the free preview and go back behind the paid gate).
 *
 * Run against the live DB (DATABASE_URL from .env):
 *   npx ts-node src/scripts/markFreeChapters.ts
 */
import mongoose from 'mongoose';
import { BookChapter } from '../app/modules/bookContent/bookContent.model';
import { Book } from '../app/modules/book/book.model';

// Chapters that should be readable as a sample. Matches are case-insensitive
// and use a substring match on `title` so "Inferior extremity", "INFERIOR
// EXTREMITY", "Inferior Extremity (Lower Limb)" all hit the same row.
const FREE_CHAPTERS: string[] = ['inferior extremity'];

// Which book those titles belong to. Without this the substring match would
// span the whole catalogue and quietly give away a chapter of some other book
// that happens to share the name. Matched case-insensitively against title.
const BOOK_TITLE = 'anatomy';

export const markFreeChapters = async () => {
  const books = await Book.find({ title: new RegExp(BOOK_TITLE, 'i') })
    .select('_id title')
    .lean();
  if (books.length === 0) throw new Error(`No book matching "${BOOK_TITLE}"`);
  if (books.length > 1) {
    throw new Error(
      `"${BOOK_TITLE}" matches ${books.length} books (${books
        .map(b => b.title)
        .join(', ')}) — narrow BOOK_TITLE so this cannot free the wrong one.`
    );
  }
  console.log(`Book: ${books[0].title}`);

  // Scoped to this one book, so a same-named chapter elsewhere is untouched —
  // including by the "flip off" branch below.
  const allChapters = await BookChapter.find({ bookId: books[0]._id, isDeleted: false })
    .select('_id title isFree')
    .lean();

  const wantsFree = new Set<string>();
  for (const needle of FREE_CHAPTERS) {
    const n = needle.trim().toLowerCase();
    for (const c of allChapters) {
      if (c.title.toLowerCase().includes(n)) wantsFree.add(String(c._id));
    }
  }

  const ops: Parameters<typeof BookChapter.bulkWrite>[0] = [];
  let flippedOn = 0;
  let flippedOff = 0;
  for (const c of allChapters) {
    const shouldBeFree = wantsFree.has(String(c._id));
    if (shouldBeFree && !c.isFree) {
      ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { isFree: true } } } });
      flippedOn++;
      console.log(`  ✓ free ON  → ${c.title}`);
    } else if (!shouldBeFree && c.isFree) {
      ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { isFree: false } } } });
      flippedOff++;
      console.log(`  ✗ free OFF → ${c.title}`);
    }
  }

  if (ops.length) await BookChapter.bulkWrite(ops);
  return { flippedOn, flippedOff, matched: wantsFree.size };
};

if (require.main === module) {
  (async () => {
    await import('../app/config');
    const { dbConnect } = await import('../app/utils/dbConnect');
    await dbConnect();
    console.log(`Scanning chapters for: ${FREE_CHAPTERS.join(', ')}`);
    const res = await markFreeChapters();
    console.log(
      `\n✅ Done — ${res.matched} chapter(s) matched, ${res.flippedOn} newly free, ${res.flippedOff} reverted to paid.`
    );
    await mongoose.disconnect();
    process.exit(0);
  })().catch(e => {
    console.error('❌ Failed:', e);
    process.exit(1);
  });
}
