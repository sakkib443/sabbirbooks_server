/* eslint-disable no-console */
/**
 * Access-gate E2E for printed-book QR content (isolated in-memory MongoDB —
 * never touches the live DB).
 *
 * The rule being pinned down:
 *   printed item → content opens only at 'delivered' / 'access-granted'
 *   digital item → content opens as soon as payment is 'paid'
 *   cancelled    → never, even if the payment was taken and later refunded
 *   free chapter → readable by any signed-in user, with no order at all
 *   next-topic   → cannot be used to walk out of a free chapter into paid content
 *
 * Run:  npx ts-node src/__tests__/book-access.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';

  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Order } = await import('../app/modules/order/order.model');
  const { Book } = await import('../app/modules/book/book.model');
  const { BookAccessService } = await import('../app/modules/bookAccess/bookAccess.service');
  const { BookContentService } = await import('../app/modules/bookContent/bookContent.service');
  const { BookPart, BookChapter, BookTopic, BookQuestion } = await import(
    '../app/modules/bookContent/bookContent.model'
  );

  const book = await Book.create({
    id: 1,
    title: 'Anatomy MAGIC VIVA',
    slug: 'anatomy-magic-viva',
    price: 500,
    author: 'Sabbir',
    category: 'medical',
    description: 'test',
  });
  const bookId = String(book._id);

  // hasBookAccess/scanTopic only ever use the id as a foreign key — they never
  // load the User document — so a bare ObjectId is a faithful stand-in and keeps
  // the fixture from coupling to the User schema's required fields.
  const mkUser = async (_label: string) => ({ _id: new mongoose.Types.ObjectId() });

  const mkOrder = async (
    userId: string,
    opts: { status: string; paymentStatus: string; format: 'printed' | 'digital' }
  ) =>
    Order.create({
      user: userId,
      items: [{ book: book._id, title: book.title, price: 500, quantity: 1, format: opts.format }],
      deliveryType: opts.format,
      subtotal: 500,
      total: 500,
      shippingAddress:
        opts.format === 'printed'
          ? { name: 'x', phone: '01700000000', address: 'a', city: 'Dhaka' }
          : undefined,
      payment: { status: opts.paymentStatus, method: 'cod' },
      status: opts.status,
    });

  console.log('\n── PRINTED book: access must wait for delivery ──');
  for (const status of ['pending', 'paid', 'processing', 'shipped']) {
    const u = await mkUser(`printed-${status}@t.com`);
    await mkOrder(String(u._id), { status, paymentStatus: 'paid', format: 'printed' });
    const ok = await BookAccessService.hasBookAccess(String(u._id), bookId);
    check(ok === false, `printed + status '${status}' + payment paid → NO access`);
  }
  for (const status of ['delivered', 'access-granted']) {
    const u = await mkUser(`printed-${status}@t.com`);
    await mkOrder(String(u._id), { status, paymentStatus: 'paid', format: 'printed' });
    const ok = await BookAccessService.hasBookAccess(String(u._id), bookId);
    check(ok === true, `printed + status '${status}' → access`);
  }

  console.log('\n── DIGITAL book: paid is enough (nothing to deliver) ──');
  {
    const u = await mkUser('digital-paid@t.com');
    await mkOrder(String(u._id), {
      status: 'access-granted',
      paymentStatus: 'paid',
      format: 'digital',
    });
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === true,
      'digital + payment paid → access'
    );
  }
  {
    const u = await mkUser('digital-pending@t.com');
    await mkOrder(String(u._id), {
      status: 'pending',
      paymentStatus: 'pending',
      format: 'digital',
    });
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === false,
      'digital + payment pending → NO access'
    );
  }

  console.log('\n── CANCELLED after payment (refund) must revoke ──');
  {
    const u = await mkUser('cancelled-digital@t.com');
    await mkOrder(String(u._id), {
      status: 'cancelled',
      paymentStatus: 'paid',
      format: 'digital',
    });
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === false,
      'digital + paid + CANCELLED → NO access'
    );
  }
  {
    const u = await mkUser('cancelled-printed@t.com');
    const o = await mkOrder(String(u._id), {
      status: 'delivered',
      paymentStatus: 'paid',
      format: 'printed',
    });
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === true,
      'printed delivered → access (control)'
    );
    o.status = 'cancelled';
    await o.save();
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === false,
      'printed delivered then CANCELLED → NO access'
    );
  }

  console.log('\n── No order at all ──');
  {
    const u = await mkUser('stranger@t.com');
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === false,
      'no order → NO access'
    );
  }

  console.log('\n── Manual admin grant still works ──');
  {
    const u = await mkUser('granted@t.com');
    await BookAccessService.grantAccess({ userId: String(u._id), bookId });
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === true,
      'manual grant → access (early-access escape hatch)'
    );
    await BookAccessService.revokeAccess(String(u._id), bookId);
    check(
      (await BookAccessService.hasBookAccess(String(u._id), bookId)) === false,
      'revoked grant → NO access'
    );
  }

  // ── Content tree: one free chapter, one paid chapter ──────────
  const part = await BookPart.create({ bookId: book._id, title: 'Board 2', order: 1 });
  const freeChapter = await BookChapter.create({
    bookId: book._id,
    partId: part._id,
    title: 'Inferior extremity',
    order: 1,
    isFree: true,
  });
  const paidChapter = await BookChapter.create({
    bookId: book._id,
    partId: part._id,
    title: 'Superior extremity',
    order: 2,
    isFree: false,
  });
  const freeTopic = await BookTopic.create({
    bookId: book._id,
    partId: part._id,
    chapterId: freeChapter._id,
    title: 'Femur',
    order: 1,
    qrCode: 'FREE0001',
  });
  const paidTopic = await BookTopic.create({
    bookId: book._id,
    partId: part._id,
    chapterId: paidChapter._id,
    title: 'Humerus',
    order: 1,
    qrCode: 'PAID0001',
  });
  await BookQuestion.create({
    bookId: book._id,
    chapterId: freeChapter._id,
    topicId: freeTopic._id,
    questionNo: '1',
    answerHtml: '<p>free answer</p>',
    order: 1,
  });
  await BookQuestion.create({
    bookId: book._id,
    chapterId: paidChapter._id,
    topicId: paidTopic._id,
    questionNo: '1',
    answerHtml: '<p>paid answer</p>',
    order: 1,
  });

  console.log('\n── Free chapter: open to any signed-in user ──');
  const broke = await mkUser('broke@t.com');
  const brokeId = String(broke._id);
  {
    const r = await BookContentService.scanTopic('FREE0001', brokeId);
    check(r.ok === true, 'free chapter QR → readable with no order');
  }
  {
    const r = await BookContentService.scanTopic('PAID0001', brokeId);
    check(
      r.ok === false && r.reason === 'no_access',
      'paid chapter QR → blocked for the same user'
    );
  }

  console.log('\n── Undelivered buyer gets "on the way", not "buy this book" ──');
  {
    const waiting = await mkUser('waiting@t.com');
    await mkOrder(String(waiting._id), {
      status: 'shipped',
      paymentStatus: 'paid',
      format: 'printed',
    });
    const r = await BookContentService.scanTopic('PAID0001', String(waiting._id));
    check(r.ok === false, 'shipped-but-not-delivered buyer still gets NO content');
    check(
      r.ok === false && r.reason === 'awaiting_delivery',
      'refusal is reported as awaiting_delivery (not "buy it again")'
    );
    // A stranger with no order must still get the plain buy prompt.
    const s = await BookContentService.scanTopic('PAID0001', brokeId);
    check(
      s.ok === false && s.reason === 'no_access',
      'user with no order still gets the buy prompt'
    );
  }

  console.log('\n── Scan payload must not leak completion stats ──');
  {
    const r = await BookContentService.scanTopic('FREE0001', brokeId);
    const data = (r as { data: Record<string, unknown> }).data;
    check(!('answeredCount' in data), 'scan payload has no answeredCount');
    check('totalCount' in data, 'scan payload still has totalCount');
  }

  console.log('\n── next-topic must not be an escape hatch out of the free chapter ──');
  {
    const next = await BookContentService.getNextTopicForReader(String(freeTopic._id), brokeId);
    check(next !== null, 'next topic after the free topic is found');
    check(next?.allowed === false, 'next topic (paid chapter) is reported as NOT allowed');
    // And the hard guarantee: even holding the code, the scan is refused.
    const r = await BookContentService.scanTopic(String(next?.qrCode), brokeId);
    check(
      r.ok === false && r.reason === 'no_access',
      'scanning that next code directly is still refused'
    );
  }

  console.log('\n── next-topic must not leak the table of contents ──');
  {
    // A user with no order and no free-chapter footing holds a PAID topic id.
    const outsider = await mkUser('outsider@t.com');
    const leak = await BookContentService.getNextTopicForReader(
      String(paidTopic._id),
      String(outsider._id)
    );
    check(leak === null, 'no-access user gets null (no title, no QR code) from next-topic');

    // A buyer walking the same path must still get their navigation.
    const buyer = await mkUser('buyer@t.com');
    await mkOrder(String(buyer._id), {
      status: 'delivered',
      paymentStatus: 'paid',
      format: 'printed',
    });
    const ok = await BookContentService.getNextTopicForReader(
      String(freeTopic._id),
      String(buyer._id)
    );
    check(ok?.allowed === true, 'delivered buyer still gets a working next-topic link');
  }

  console.log('\n── A retired free chapter must stop being free ──');
  {
    const u = await mkUser('after-retire@t.com');
    check(
      (await BookContentService.scanTopic('FREE0001', String(u._id))).ok === true,
      'free chapter readable while published (control)'
    );

    await BookChapter.updateOne({ _id: freeChapter._id }, { $set: { isPublished: false } });
    const r = await BookContentService.scanTopic('FREE0001', String(u._id));
    check(r.ok === false, 'unpublished free chapter → NO free access');

    await BookChapter.updateOne(
      { _id: freeChapter._id },
      { $set: { isPublished: true, isDeleted: true } }
    );
    const r2 = await BookContentService.scanTopic('FREE0001', String(u._id));
    check(r2.ok === false, 'soft-deleted free chapter → NO free access');

    // Restore so the fixture stays truthful if more checks are appended.
    await BookChapter.updateOne({ _id: freeChapter._id }, { $set: { isDeleted: false } });
  }

  console.log('\n── Protected media is gated by book access ──');
  {
    const { signMediaToken, verifyMediaToken, withMediaTokens } = await import(
      '../app/modules/bookContent/mediaToken'
    );

    // Attach a figure to the PAID topic's question.
    await BookQuestion.updateOne(
      { topicId: paidTopic._id },
      { $set: { images: ['https://x.test/api/book-content/media/1700000000-diagram.png'] } }
    );

    const buyer = await mkUser('media-buyer@t.com');
    await mkOrder(String(buyer._id), {
      status: 'delivered',
      paymentStatus: 'paid',
      format: 'printed',
    });

    check(
      (await BookContentService.canReadProtectedMedia(
        '1700000000-diagram.png',
        String(buyer._id)
      )) === true,
      'delivered buyer can read the figure'
    );
    check(
      (await BookContentService.canReadProtectedMedia(
        '1700000000-diagram.png',
        brokeId
      )) === false,
      'non-buyer CANNOT read the figure'
    );
    check(
      (await BookContentService.canReadProtectedMedia('not-referenced.png', String(buyer._id))) ===
        false,
      'a file no question references is refused (no public bucket)'
    );
    // Prefix confusion: "0000-diagram.png" must not match "1700000000-diagram.png".
    check(
      (await BookContentService.canReadProtectedMedia(
        '0000-diagram.png',
        String(buyer._id)
      )) === false,
      'partial filename match is refused'
    );

    // Token round-trip and scope separation.
    const t = signMediaToken(String(buyer._id));
    check(verifyMediaToken(t) === String(buyer._id), 'media token round-trips to its user');
    check(verifyMediaToken('garbage') === null, 'garbage media token rejected');

    const jwtLib = (await import('jsonwebtoken')).default;
    const cfg = (await import('../app/config')).default;
    const accessLike = jwtLib.sign({ _id: String(buyer._id), role: 'admin' }, cfg.jwt.access_secret);
    check(
      verifyMediaToken(accessLike) === null,
      'a normal access token is NOT accepted as a media token (scope enforced)'
    );

    // Stamping walks nested arrays/objects.
    const stamped = withMediaTokens(
      { videos: [{ url: 'https://x.test/api/book-content/media/a.mp4' }], other: 'untouched' },
      String(buyer._id)
    );
    check(
      stamped.videos[0].url.includes('?t='),
      'withMediaTokens stamps nested media URLs'
    );
    check(stamped.other === 'untouched', 'withMediaTokens leaves non-media strings alone');

    // answerHtml is a document, not a URL — the token must land on each embedded
    // src, not on the end of the article.
    const html = withMediaTokens(
      {
        answerHtml:
          '<p>দেখুন</p><img src="https://x.test/api/book-content/media/a.png" alt="a">' +
          '<p>আর</p><img src="https://x.test/api/book-content/media/b.png">',
      },
      String(buyer._id)
    ).answerHtml;
    check(
      (html.match(/\?t=/g) || []).length === 2,
      'both embedded <img> URLs in answerHtml are stamped'
    );
    check(
      html.includes('.png?t=') && html.endsWith('>'),
      'the token lands inside the src, not appended to the whole document'
    );
    // The regex must stop at the quote — swallowing it would produce
    // src="…png?t=abc alt=" and break the tag.
    check(html.includes(`a.png?t=${t}" alt="a"`), 'src quote and following attributes intact');
  }

  console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Harness error:', e);
  process.exit(1);
});
