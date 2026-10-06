/**
 * fillEnglishContent — fills blank English copy beside the shop's exact
 * Bengali, and leaves everything else alone. In-memory MongoDB only.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`, detail ?? '');
  }
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const { Book } = await import('../app/modules/book/book.model');
  const { Settings } = await import('../app/modules/settings/settings.model');
  const { fillEnglishContent } = await import('../app/utils/fillEnglishContent');

  // The live book's copy, verbatim (including its colour marks).
  const live = await Book.create({
    title: 'MAGIC VIVA ANATOMY', slug: 'anatomy-magic-viva', price: 650, format: 'printed', id: 1,
    description:
      'প্রিয় 1st Prof. পরীক্ষার্থীরা, \n\nএনাটমির মত একটা ভাস্ট সাবজেক্ট মাত্র 267 পেজে সম্পূর্ণ ভাইবা কমপ্লিট সাথে রিটেন 90% কাভার।\n\nনতুন সিলেবাস অনুযায়ী Board-1 এ 70 Cards; Board-2 তে 100 Cards সংবলিত দেশের একমাত্র বই।',
    features: [
      { text: 'এনাটমির মত একটা ভাস্ট সাবজেক্ট [[red b|মাত্র 267 পেজে]] সম্পূর্ণ ভাইবা কমপ্লিট সাথে রিটেন 90% কাভার।' },
      { text: 'নতুন সিলেবাস অনুযায়ী Board-1 এ 70 Cards; [[red b big|Board-2 তে 100 Cards ]]সংবলিত [[green b big|দেশের একমাত্র বই]]।' },
      { text: 'সম্পূর্ণ Practical(OSPE, Dissection, Surface Marking, Radiology) এর সমাধান এক জাইগাতেই।' },
      { text: 'মাত্র 3 ঘণ্টায় দুই বোর্ডের সমস্ত স্পেশাল ফিগার পড়ে ফেলার সুযোগ।' },
      { text: 'একটা বইয়ের সাথেই প্রয়োজনীয় সকল ম্যাটেরিয়ালস; ছবি, ভিডিও, এক্সট্রা ইনফর্মেশন।' },
      { text: 'অ্যাডমিনের নিজের নতুন লাইন' },
      { text: 'সম্পূর্ণ Practical(OSPE, Dissection, Surface Marking, Radiology) এর সমাধান এক জাইগাতেই।', textEn: 'Admin wrote this' },
    ],
  } as any);
  await Settings.create({ deliveryNote: 'সারা দেশে ১-৩ কর্মদিবসের ভিতরে পৌঁছে যাবে ইনশাআল্লাহ।' } as any);

  const n = await fillEnglishContent();
  check('fills the book and the settings', n === 2, n);

  const b: any = await Book.findById(live._id).lean();
  check('description translated', /^Dear 1st Prof/.test(b.descriptionEn), b.descriptionEn);
  check('Bengali description untouched', b.description.startsWith('প্রিয়'));
  check('marked-up features matched', /only 267 pages/.test(b.features[0].textEn) && /Board-2/.test(b.features[1].textEn), b.features.slice(0, 2));
  check('all five shop lines translated', b.features.slice(0, 5).every((f: any) => f.textEn), b.features);
  check('an unknown line stays blank', !b.features[5].textEn, b.features[5]);
  check("an admin's own English is kept", b.features[6].textEn === 'Admin wrote this', b.features[6]);

  const s: any = await Settings.findOne().lean();
  check('delivery note translated', /1–3 working days/.test(s.deliveryNoteEn), s.deliveryNoteEn);

  check('second run does nothing', (await fillEnglishContent()) === 0);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
