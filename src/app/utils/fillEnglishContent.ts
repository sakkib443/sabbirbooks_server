import { Book } from '../modules/book/book.model';
import { Settings } from '../modules/settings/settings.model';

/**
 * English versions of the shop's own Bengali copy, for the site's English mode.
 *
 * Runs at boot and only ever fills an English field that is still BLANK, and
 * only when the Bengali beside it is exactly the text translated here — so an
 * admin's own English, or Bengali they have since rewritten, is never touched.
 * Idempotent: once filled, every later boot finds nothing to do.
 *
 * Keys are the Bengali with formatting marks and whitespace stripped, so a
 * stray space or a colour mark ([[red b|…]]) changing does not stop the match.
 */
const key = (s: string) =>
  String(s || '')
    .replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\s+/g, '');

const DESCRIPTIONS: Record<string, string> = {
  [key(
    'প্রিয় 1st Prof. পরীক্ষার্থীরা, এনাটমির মত একটা ভাস্ট সাবজেক্ট মাত্র 267 পেজে সম্পূর্ণ ভাইবা কমপ্লিট সাথে রিটেন 90% কাভার। নতুন সিলেবাস অনুযায়ী Board-1 এ 70 Cards; Board-2 তে 100 Cards সংবলিত দেশের একমাত্র বই।'
  )]:
    'Dear 1st Prof. examinees,\n\nA subject as vast as Anatomy — the complete viva in only 267 pages, plus 90% of the written exam.\n\nPer the new syllabus, 70 cards for Board-1 and 100 cards for Board-2 — the only such book in the country.',
};

const FEATURES: Record<string, string> = {
  [key('এনাটমির মত একটা ভাস্ট সাবজেক্ট মাত্র 267 পেজে সম্পূর্ণ ভাইবা কমপ্লিট সাথে রিটেন 90% কাভার।')]:
    'A subject as vast as Anatomy — the complete viva in [[red b|only 267 pages]], plus 90% of the written exam.',
  [key('নতুন সিলেবাস অনুযায়ী Board-1 এ 70 Cards; Board-2 তে 100 Cards সংবলিত দেশের একমাত্র বই।')]:
    'Per the new syllabus, 70 cards for Board-1 and [[red b big|100 cards for Board-2]] — [[green b big|the only such book in the country]].',
  [key('সম্পূর্ণ Practical(OSPE, Dissection, Surface Marking, Radiology) এর সমাধান এক জাইগাতেই।')]:
    'Every practical (OSPE, Dissection, Surface Marking, Radiology) solved in one place.',
  [key('মাত্র 3 ঘণ্টায় দুই বোর্ডের সমস্ত স্পেশাল ফিগার পড়ে ফেলার সুযোগ।')]:
    'Read every special figure from both boards in just 3 hours.',
  [key('একটা বইয়ের সাথেই প্রয়োজনীয় সকল ম্যাটেরিয়ালস; ছবি, ভিডিও, এক্সট্রা ইনফর্মেশন।')]:
    'Everything you need with one book — images, videos and extra information.',
};

const DELIVERY_NOTES: Record<string, string> = {
  [key('সারা দেশে ১-৩ কর্মদিবসের ভিতরে পৌঁছে যাবে ইনশাআল্লাহ।')]:
    'Delivered anywhere in Bangladesh within 1–3 working days, InshaAllah.',
};

export async function fillEnglishContent(): Promise<number> {
  let filled = 0;

  const books = await Book.find({}).select('description descriptionEn features');
  for (const book of books as any[]) {
    let changed = false;

    const desc = DESCRIPTIONS[key(book.description)];
    if (desc && !String(book.descriptionEn || '').trim()) {
      book.descriptionEn = desc;
      changed = true;
    }

    for (const f of book.features || []) {
      const en = FEATURES[key(f.text)];
      if (en && !String(f.textEn || '').trim()) {
        f.textEn = en;
        changed = true;
      }
    }

    if (changed) {
      book.markModified('features');
      await book.save();
      filled++;
    }
  }

  const settings: any = await Settings.findOne({});
  if (settings) {
    const note = DELIVERY_NOTES[key(settings.deliveryNote)];
    if (note && !String(settings.deliveryNoteEn || '').trim()) {
      settings.deliveryNoteEn = note;
      await settings.save();
      filled++;
    }
  }

  return filled;
}
