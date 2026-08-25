/* eslint-disable no-console */
/**
 * Read-only: what does the live book actually contain, and is anything free?
 *
 * The shop's landing page shows a table of contents and a "read a free chapter"
 * button, both of which are built from this data — so before blaming the page
 * for showing nothing, check whether there is anything to show.
 *
 * Writes NOTHING. Every query here is a find/count.
 *
 * Run: npx ts-node src/scripts/checkFreeChapters.ts
 */
import mongoose from 'mongoose';
import config from '../app/config';
import { Book } from '../app/modules/book/book.model';
import { BookPart, BookChapter, BookTopic, BookQuestion } from '../app/modules/bookContent/bookContent.model';

async function main() {
  await mongoose.connect(config.database_url as string);

  const books = await Book.find({ status: 'published' }).select('_id title slug').lean();
  console.log(`\nPublished books: ${books.length}`);

  for (const book of books) {
    const live = { bookId: book._id, isDeleted: false, isPublished: true };
    const [parts, chapters, topics, questions, freeChapters] = await Promise.all([
      BookPart.countDocuments(live),
      BookChapter.countDocuments(live),
      BookTopic.countDocuments(live),
      BookQuestion.countDocuments(live),
      BookChapter.find({ ...live, isFree: true }).select('chapterNo title').lean(),
    ]);

    console.log(`\n── ${book.title} (${book.slug})`);
    console.log(`   parts ${parts} · chapters ${chapters} · topics ${topics} · questions ${questions}`);
    console.log(`   free chapters: ${freeChapters.length}`);
    for (const ch of freeChapters) {
      const topicCount = await BookTopic.countDocuments({ ...live, chapterId: ch._id });
      console.log(`     • ${ch.chapterNo ?? '-'} ${ch.title} — ${topicCount} topic(s)`);
    }
  }

  await mongoose.disconnect();
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
