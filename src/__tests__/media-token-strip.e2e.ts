/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Media tokens must never be stored, and a stored one must never break a page.
 *
 * The API stamps a 30-minute `?t=…` token onto every figure URL it serves, so
 * an <img> can load a protected file. The admin editor sent those URLs back
 * on save exactly as received, and the server stored them — token and all.
 * When the API later served such a row it stamped a SECOND token on top, the
 * browser sent `?t=NEW?t=OLD` as one garbage token, verification failed, and
 * the reader saw a broken image. Twenty-one questions were in that state.
 *
 * Three guarantees, each checked here:
 *   1. the pure strip function does exactly the job and nothing else
 *   2. serving a poisoned row yields ONE valid token (so old rows work at once)
 *   3. saving through the real HTTP route stores the URL clean
 *
 * Runs against an in-memory MongoDB, never the live one.
 *
 * Run: npx ts-node src/__tests__/media-token-strip.e2e.ts
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let passed = 0;
let failed = 0;
const check = (ok: boolean, label: string, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};

const M = 'https://magicviva.com/api/book-content/media';

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test-secret';
  await mongoose.connect(mongod.getUri(), { dbName: 'media-token-strip' });

  const { stripMediaTokens, withoutMediaTokens, withMediaTokens, verifyMediaToken, signMediaToken } =
    await import('../app/modules/bookContent/mediaToken');
  const { sanitizeQuestionPayload } = await import('../app/modules/bookContent/sanitizeAnswer');

  console.log('\n── 1. The strip, on its own ──────────────────────────');
  {
    check(stripMediaTokens(`${M}/a.png?t=AAA`) === `${M}/a.png`, 'one token is removed');
    check(stripMediaTokens(`${M}/a.png?t=AAA?t=BBB`) === `${M}/a.png`, 'a doubled token is removed whole');
    check(stripMediaTokens(`${M}/a.png`) === `${M}/a.png`, 'a clean URL is untouched');
    check(
      stripMediaTokens('https://youtu.be/JJ0yNHvsXHg?si=q0IPsjumg8ckoNi4') === 'https://youtu.be/JJ0yNHvsXHg?si=q0IPsjumg8ckoNi4',
      'a YouTube link keeps its own query string'
    );
    check(
      stripMediaTokens(`<p>see <img src="${M}/fig.png?t=AAA" alt="x"> here</p>`) === `<p>see <img src="${M}/fig.png" alt="x"> here</p>`,
      'a token inside an <img src> in HTML is removed, and the closing quote survives'
    );
    check(stripMediaTokens('no media here ?t=AAA') === 'no media here ?t=AAA', 'a ?t= that is not on a media URL is left alone');

    const deep = withoutMediaTokens({
      images: [`${M}/1.png?t=A`, `${M}/2.png`],
      attachments: [{ fileUrl: `${M}/doc.pdf?t=A`, title: 'x' }],
      videos: [{ url: 'https://youtu.be/abc?si=zz', provider: 'youtube' }],
      answerHtml: `<img src="${M}/f.png?t=A">`,
      order: 3,
    });
    check(deep.images[0] === `${M}/1.png` && deep.images[1] === `${M}/2.png`, 'images[] cleaned');
    check(deep.attachments[0].fileUrl === `${M}/doc.pdf` && deep.attachments[0].title === 'x', 'attachments[].fileUrl cleaned, other fields kept');
    check(deep.videos[0].url === 'https://youtu.be/abc?si=zz', 'videos[].url (YouTube) untouched');
    check(deep.answerHtml === `<img src="${M}/f.png">`, 'answerHtml cleaned');
    check(deep.order === 3, 'non-string fields untouched');
  }

  console.log('\n── 2. Serving a row that was stored WITH a token ─────');
  {
    const served = withMediaTokens({ images: [`${M}/x.png?t=OLDEXPIRED`] }, 'user1').images[0];
    const tokens = served.match(/\?t=/g) || [];
    check(tokens.length === 1, 'exactly one ?t= on the way out', served);
    const t = new URL(served).searchParams.get('t') || '';
    check(verifyMediaToken(t) === 'user1', 'and it is a valid token for the reader', t.slice(0, 20));
  }

  console.log('\n── 3. sanitizeQuestionPayload strips on the way in ───');
  {
    const out: any = sanitizeQuestionPayload({
      questionText: 'q',
      images: [`${M}/1.png?t=A?t=B`],
      answerHtml: `<p>x</p><script>alert(1)</script><img src="${M}/f.png?t=A">`,
    });
    check(out.images[0] === `${M}/1.png`, 'images cleaned');
    check(!out.answerHtml.includes('<script'), 'script still removed');
    check(out.answerHtml.includes(`src="${M}/f.png"`), 'and the img token removed too', out.answerHtml);
    const noHtml: any = sanitizeQuestionPayload({ images: [`${M}/1.png?t=A`] });
    check(noHtml.images[0] === `${M}/1.png`, 'a payload without answerHtml is still cleaned');
  }

  console.log('\n── 4. Through the real routes, end to end ────────────');
  {
    const appMod = await import('../app');
    const app = (appMod as any).default || appMod;
    const { PROTECTED_MEDIA_DIR } = await import('../app/config/localUpload');
    const { Book } = await import('../app/modules/book/book.model');
    const { BookPart, BookChapter, BookTopic, BookQuestion } = await import('../app/modules/bookContent/bookContent.model');
    const { User } = await import('../app/modules/user/user.model');
    const { BookAccess } = await import('../app/modules/bookAccess/bookAccess.model');

    const FILE = 'strip-test-figure.png';
    fs.mkdirSync(PROTECTED_MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(PROTECTED_MEDIA_DIR, FILE), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const book: any = await Book.create({ id: 1, title: 'B', slug: 'b', price: 1, author: 'a', category: 'medical', description: 'd', format: 'printed', stock: 1 });
    const part: any = await BookPart.create({ bookId: book._id, title: 'P', order: 1 });
    const chapter: any = await BookChapter.create({ bookId: book._id, partId: part._id, chapterNo: '1', title: 'C', isFree: false, order: 1 });
    const topic: any = await BookTopic.create({ bookId: book._id, partId: part._id, chapterId: chapter._id, topicNo: '1.1', title: 'T', qrCode: 'STRIPQR1', order: 1, isPublished: true });
    // Stored the way the bug stored it: with a stale token already inside.
    const q: any = await BookQuestion.create({
      bookId: book._id, partId: part._id, chapterId: chapter._id, topicId: topic._id,
      questionNo: '1', questionText: 'q', isPublished: true, isDeleted: false,
      images: [`https://x.test/api/book-content/media/${FILE}?t=STALE`],
    });

    // A reader who owns the book.
    await request(app).post('/api/auth/register').send({ firstName: 'R', lastName: 'R', email: 'r@t.com', password: 'pass1234', whatsappNumber: '01712345678' });
    const login = await request(app).post('/api/auth/login').send({ email: 'r@t.com', password: 'pass1234' });
    const token = login.body?.data?.accessToken;
    const reader: any = await User.findOne({ email: 'r@t.com' }).lean();
    await BookAccess.create({ userId: reader._id, bookId: book._id, source: 'manual' });

    // (a) A row stored WITH a token is not served — even though the token on the
    //     way out is now a single valid one. The route finds a file's owning
    //     question by matching the stored URL anchored at its END, and a stored
    //     URL that ends in "?t=…" does not end in the file name. That anchor is
    //     a deliberate security property ("12-a.jpg" must not match "912-a.jpg")
    //     and is left alone; it is why the stored rows have to be repaired, not
    //     merely served differently.
    const poisoned = await request(app).get(
      `/api/book-content/media/${FILE}?t=${signMediaToken(String(reader._id))}`
    );
    check(poisoned.status === 403, 'a row stored with a token is refused — the data repair is required', poisoned.status);

    // (b) What a browser sent before the fix — a doubled token — is refused too.
    const doubled = await request(app).get(`/api/book-content/media/${FILE}?t=${signMediaToken(String(reader._id))}?t=STALE`);
    check(doubled.status === 401, 'a doubled token is refused (this was the broken image)', doubled.status);

    // (c) The editor's save path — the one that caused all of it — now stores
    //     clean, even when handed a doubled token exactly as the editor used to.
    await User.updateOne({ email: 'r@t.com' }, { role: 'superAdmin' });
    const relogin = await request(app).post('/api/auth/login').send({ email: 'r@t.com', password: 'pass1234' });
    const admin = relogin.body?.data?.accessToken;
    const patch = await request(app)
      .patch(`/api/book-content/questions/${q._id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ images: [`https://x.test/api/book-content/media/${FILE}?t=FRESH?t=STALE`], attachments: [{ title: 'p', fileUrl: `https://x.test/api/book-content/media/x.pdf?t=Z`, fileType: 'pdf' }] });
    check(patch.status === 200, 'PATCH accepted', patch.body?.message);
    const stored: any = await BookQuestion.findById(q._id).lean();
    check(stored.images[0] === `https://x.test/api/book-content/media/${FILE}`, 'stored image URL is clean', stored.images[0]);
    check(stored.attachments[0].fileUrl === 'https://x.test/api/book-content/media/x.pdf', 'stored attachment URL is clean', stored.attachments[0]?.fileUrl);

    // (d) And a clean row is served the whole way through: scan → one valid
    //     token → the image itself loads. This is the reader's experience once
    //     the stored rows are repaired.
    await User.updateOne({ email: 'r@t.com' }, { role: 'student' });
    const scan = await request(app).get('/api/book-content/scan/STRIPQR1').set('Authorization', `Bearer ${token}`);
    const src: string = scan.body?.data?.questions?.[0]?.images?.[0] || '';
    check(scan.status === 200, 'scan opens', scan.status);
    check((src.match(/\?t=/g) || []).length === 1, 'served URL carries exactly one token', src);
    const img = await request(app).get(src.replace(/^https?:\/\/[^/]+/, ''));
    check(img.status === 200, 'and the image itself loads (200)', img.status);

    fs.unlinkSync(path.join(PROTECTED_MEDIA_DIR, FILE));
  }

  console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
