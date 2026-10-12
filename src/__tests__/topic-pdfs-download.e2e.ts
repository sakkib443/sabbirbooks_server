/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Downloading a topic's PDFs (isolated in-memory MongoDB, the real Express app
 * via supertest; never the live DB).
 *
 * The complaint: tapping "download" on a topic's PDF opened a grey tab that
 * never finished on a phone, and there was no way to get all of a topic's PDFs
 * at once. What has to hold now:
 *
 *   - ?download=1 makes the media route send the file as an ATTACHMENT, under
 *     the attachment's title (Bengali included), with .pdf on the end
 *   - without it the route behaves exactly as before (the in-page viewer and
 *     every <img> depend on that)
 *   - "download all" merges every PDF in the topic's questions, in question
 *     order, into one PDF; a file that cannot be read is left out and named
 *   - it is built once and then served from disk; when a PDF changes the next
 *     request builds a new one and the stale one is deleted
 *   - access is exactly the media route's: buyer yes, stranger no, signed-out
 *     no — except a free chapter, which is open to all
 *   - a whole class asking at once gets one build, and every one of them the file
 *
 * Run:  npx ts-node --transpile-only src/__tests__/topic-pdfs-download.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { PDFDocument } from 'pdf-lib';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
  }
}

/** A PDF of `pages` pages, each `size` points square — the size tells us which source a page came from. */
async function makePdf(pages: number, size: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([size, size]);
  return Buffer.from(await doc.save());
}

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { Book } = await import('../app/modules/book/book.model');
  const { BookPart, BookChapter, BookTopic, BookQuestion } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { BookAccess } = await import('../app/modules/bookAccess/bookAccess.model');
  const { PROTECTED_MEDIA_DIR } = await import('../app/config/localUpload');
  const { BUNDLE_DIR } = await import('../app/modules/bookContent/topicPdfBundle');
  const { signMediaToken } = await import('../app/modules/bookContent/mediaToken');

  const stamp = Date.now();
  const written: string[] = [];
  const put = (name: string, body: Buffer) => {
    fs.mkdirSync(PROTECTED_MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(PROTECTED_MEDIA_DIR, name), body);
    written.push(name);
    return name;
  };
  const A = put(`${stamp}-tpd-a.pdf`, await makePdf(2, 200)); // question 1
  const B = put(`${stamp}-tpd-b.pdf`, await makePdf(3, 300)); // question 2
  const BROKEN = put(`${stamp}-tpd-broken.pdf`, Buffer.from('this is not a pdf at all'));
  const ONLY = put(`${stamp}-tpd-only.pdf`, await makePdf(1, 400));
  const FREE = put(`${stamp}-tpd-free.pdf`, await makePdf(1, 500));
  const FREE2 = put(`${stamp}-tpd-free2.pdf`, await makePdf(2, 600));
  const media = (f: string) => `https://magicviva.com/api/book-content/media/${f}`;

  const book = await Book.create({
    id: 1, title: 'Anatomy', slug: 'anatomy', price: 650, author: 'S', category: 'medical', description: 'x', format: 'printed',
  });
  const part = await BookPart.create({ bookId: book._id, title: 'Board I', order: 1 });
  const paid = await BookChapter.create({ bookId: book._id, partId: part._id, title: 'Head and Neck', order: 1, isFree: false });
  const free = await BookChapter.create({ bookId: book._id, partId: part._id, title: 'Free sample', order: 2, isFree: true });
  const mkTopic = (chapterId: unknown, title: string, order: number, qrCode: string, topicNo?: string) =>
    BookTopic.create({ bookId: book._id, partId: part._id, chapterId, title, order, qrCode, topicNo });
  const scalp = await mkTopic(paid._id, 'Scalp', 1, 'TPDSCALP', '3');
  const single = await mkTopic(paid._id, 'Face', 2, 'TPDFACE1');
  const empty = await mkTopic(paid._id, 'Neck', 3, 'TPDNECK1');
  const freeTopic = await mkTopic(free._id, 'Sample topic', 1, 'TPDFREE1');
  const q = (topic: any, chapterId: unknown, order: number, attachments: any[]) =>
    BookQuestion.create({ bookId: book._id, chapterId, topicId: topic._id, questionNo: String(order), order, attachments });

  // Question order is 1, 2, 3 — but created out of order to prove the sort.
  await q(scalp, paid._id, 2, [
    { title: 'Scalp Q2 notes', fileUrl: media(B), fileType: 'pdf' },
    { title: 'Scalp diagram', fileUrl: media(`${stamp}-tpd-fig.png`), fileType: 'image' }, // not a PDF: ignored
  ]);
  await q(scalp, paid._id, 1, [{ title: 'স্কাল্প — উত্তর', fileUrl: media(A), fileType: 'pdf' }]);
  await q(scalp, paid._id, 3, [{ title: 'Corrupt upload', fileUrl: media(BROKEN), fileType: 'pdf' }]);
  await q(single, paid._id, 1, [{ title: 'Face answer', fileUrl: media(ONLY), fileType: 'pdf' }]);
  await q(empty, paid._id, 1, []);
  await q(freeTopic, free._id, 1, [
    { title: 'Free one', fileUrl: media(FREE), fileType: 'pdf' },
    { title: 'Free two', fileUrl: media(FREE2), fileType: 'pdf' },
  ]);

  const buyer = String(new mongoose.Types.ObjectId());
  const stranger = String(new mongoose.Types.ObjectId());
  await BookAccess.create({ userId: buyer, bookId: book._id, source: 'manual' });
  const bearer = (id: string) => `Bearer ${jwt.sign({ _id: id, role: 'student' }, 'test_access_secret', { expiresIn: '1h' })}`;
  const api = () => request(app);

  console.log('\n— One PDF, tapped "download": saved, not opened in a tab');
  {
    const t = signMediaToken(buyer);
    const viewed = await api().get(`/api/book-content/media/${A}?t=${t}`).buffer(true).parse(binary);
    check(viewed.status === 200 && !viewed.headers['content-disposition'], 'without ?download the route is unchanged (no attachment)', viewed.headers['content-disposition']);

    const name = encodeURIComponent('স্কাল্প — উত্তর');
    const dl = await api().get(`/api/book-content/media/${A}?t=${t}&download=1&name=${name}`).buffer(true).parse(binary);
    const cd = String(dl.headers['content-disposition'] || '');
    check(dl.status === 200 && cd.startsWith('attachment;'), 'with ?download=1 it is an attachment', cd);
    check(cd.includes(`filename*=UTF-8''${encodeURIComponent('স্কাল্প — উত্তর.pdf')}`), 'saved under the Bengali title, with .pdf added', cd);
    check(cd.includes('filename="magic-viva.pdf"'), 'plain-ASCII fallback name for old browsers', cd);
    check(Buffer.compare(dl.body, fs.readFileSync(path.join(PROTECTED_MEDIA_DIR, A))) === 0, 'the bytes are the file');

    const plain = await api().get(`/api/book-content/media/${A}?t=${t}&download=1`);
    check(String(plain.headers['content-disposition']).includes('filename="tpd-a.pdf"'), 'no name given: the stored name without its upload prefix', plain.headers['content-disposition']);

    const odd = await api().get(`/api/book-content/media/${A}?t=${t}&download=1&name=${encodeURIComponent('a/b\\c"d<e>\r\nf')}`);
    const oddCd = String(odd.headers['content-disposition']);
    check(!/[\r\n]/.test(oddCd) && oddCd.includes('filename="a b c d e f.pdf"'), 'slashes, quotes and line breaks in a title cannot break the header', oddCd);

    const etag = viewed.headers.etag;
    const again = await api().get(`/api/book-content/media/${A}?t=${t}&download=1`).set('If-None-Match', etag);
    check(again.status === 200, 'a download is never answered 304 (nothing to save)', again.status);
    const view304 = await api().get(`/api/book-content/media/${A}?t=${t}`).set('If-None-Match', etag);
    check(view304.status === 304, 'viewing still gets its 304', view304.status);

    const ranged = await api().get(`/api/book-content/media/${A}?t=${t}&download=1`).set('Range', 'bytes=10-19');
    check(ranged.status === 206 && ranged.headers['content-range']?.startsWith('bytes 10-19/'), 'a dropped download can resume (Range → 206)', ranged.status);
  }

  console.log('\n— "Download all": who may');
  {
    const url = `/api/book-content/topic-pdfs/${scalp._id}`;
    check((await api().get(url)).status === 401, 'signed out → 401');
    check((await api().get(url).set('Authorization', bearer(stranger))).status === 403, 'not bought → 403');
    check((await api().get('/api/book-content/topic-pdfs/not-an-id').set('Authorization', bearer(buyer))).status === 404, 'bad topic id → 404');
    check((await api().get(`/api/book-content/topic-pdfs/${empty._id}`).set('Authorization', bearer(buyer))).status === 404, 'a topic with no PDF → 404');
  }

  console.log('\n— "Download all": what the buyer gets');
  let fileUrl = '';
  {
    const res = await api().get(`/api/book-content/topic-pdfs/${scalp._id}`).set('Authorization', bearer(buyer));
    const d = res.body.data || {};
    check(res.status === 200, 'buyer → 200', res.body);
    check(d.count === 2 && d.pages === 5, 'two PDFs merged, 2 + 3 = 5 pages', { count: d.count, pages: d.pages });
    check(JSON.stringify(d.included) === JSON.stringify(['স্কাল্প — উত্তর', 'Scalp Q2 notes']), 'in question order (Q1, then Q2)', d.included);
    check(JSON.stringify(d.skipped) === JSON.stringify(['Corrupt upload']), 'the unreadable file is named, not silently lost', d.skipped);
    check(typeof d.url === 'string' && d.url.startsWith(`/api/book-content/topic-pdfs/${scalp._id}/file?t=`) && d.url.includes('download=1'), 'a same-site link carrying the media token', d.url);
    fileUrl = d.url;

    const file = await api().get(fileUrl).buffer(true).parse(binary);
    const cd = String(file.headers['content-disposition'] || '');
    check(file.status === 200 && file.headers['content-type'] === 'application/pdf', 'the link serves a PDF', file.status);
    check(cd.startsWith('attachment;') && cd.includes(encodeURIComponent('3. Scalp - all PDFs.pdf')), 'as a download named after the topic', cd);
    const merged = await PDFDocument.load(file.body);
    const sizes = merged.getPages().map((p) => Math.round(p.getWidth()));
    check(JSON.stringify(sizes) === JSON.stringify([200, 200, 300, 300, 300]), 'pages are A then B, untouched', sizes);

    const ranged = await api().get(fileUrl).set('Range', 'bytes=0-99');
    check(ranged.status === 206, 'the merged file resumes too (Range → 206)', ranged.status);

    check((await api().get(fileUrl.replace(/t=[^&]+&/, ''))).status === 401, 'the file link without a token → 401');
    check((await api().get(`/api/book-content/topic-pdfs/${scalp._id}/file?t=${signMediaToken(stranger)}`)).status === 403, 'with a stranger\'s token → 403');
  }

  console.log('\n— Built once, rebuilt when a PDF changes');
  {
    const bundles = () => fs.readdirSync(BUNDLE_DIR).filter((n) => n.startsWith(String(scalp._id)) && n.endsWith('.pdf'));
    const first = bundles();
    const mtime = fs.statSync(path.join(BUNDLE_DIR, first[0])).mtimeMs;
    await api().get(`/api/book-content/topic-pdfs/${scalp._id}`).set('Authorization', bearer(buyer));
    check(bundles().length === 1 && fs.statSync(path.join(BUNDLE_DIR, first[0])).mtimeMs === mtime, 'asking again reuses the file on disk', bundles());

    // The admin attaches a new PDF to question 1.
    const C = put(`${stamp}-tpd-c.pdf`, await makePdf(1, 350));
    await BookQuestion.updateOne(
      { topicId: scalp._id, order: 1 },
      { $push: { attachments: { title: 'Scalp extra', fileUrl: media(C), fileType: 'pdf' } } }
    );
    const res = await api().get(`/api/book-content/topic-pdfs/${scalp._id}`).set('Authorization', bearer(buyer));
    check(res.body.data?.pages === 6 && res.body.data?.count === 3, 'a new PDF is in the next download', res.body.data);
    const now = bundles();
    check(now.length === 1 && now[0] !== first[0], 'the stale bundle is deleted', { before: first, after: now });
  }

  console.log('\n— A topic with one PDF needs no merging');
  {
    const res = await api().get(`/api/book-content/topic-pdfs/${single._id}`).set('Authorization', bearer(buyer));
    const url: string = res.body.data?.url || '';
    check(res.status === 200 && url.startsWith(`/api/book-content/media/${ONLY}?t=`), 'the link is that file itself', url);
    const file = await api().get(url);
    check(file.status === 200 && String(file.headers['content-disposition']).includes(encodeURIComponent('Face answer.pdf')), 'downloaded under its own title', file.headers['content-disposition']);
  }

  console.log('\n— A free chapter: open to everyone, signed in or not');
  {
    const res = await api().get(`/api/book-content/topic-pdfs/${freeTopic._id}`);
    check(res.status === 200 && res.body.data?.pages === 3, 'signed out → 200, 1 + 2 pages', res.body);
    check(!/[?&]t=/.test(res.body.data?.url || ''), 'no token in the link (none needed)', res.body.data?.url);
    const file = await api().get(res.body.data.url);
    check(file.status === 200, 'and the file downloads', file.status);
  }

  console.log('\n— A whole class taps "download all" at once');
  {
    // A fresh topic, so nothing is cached yet.
    const D = put(`${stamp}-tpd-d.pdf`, await makePdf(4, 210));
    const E = put(`${stamp}-tpd-e.pdf`, await makePdf(4, 220));
    const rush = await mkTopic(paid._id, 'Rush', 9, 'TPDRUSH1');
    await q(rush, paid._id, 1, [
      { title: 'D', fileUrl: media(D), fileType: 'pdf' },
      { title: 'E', fileUrl: media(E), fileType: 'pdf' },
    ]);
    const students = Array.from({ length: 40 }, () => String(new mongoose.Types.ObjectId()));
    await BookAccess.insertMany(students.map((s) => ({ userId: s, bookId: book._id, source: 'manual' })));
    const results = await Promise.all(
      students.map(async (s) => {
        const prep = await api().get(`/api/book-content/topic-pdfs/${rush._id}`).set('Authorization', bearer(s));
        if (prep.status !== 200) return { prep: prep.status, file: 0, pages: 0 };
        const file = await api().get(prep.body.data.url).buffer(true).parse(binary);
        const pages = file.status === 200 ? (await PDFDocument.load(file.body)).getPageCount() : 0;
        return { prep: prep.status, file: file.status, pages };
      })
    );
    const ok = results.filter((r) => r.prep === 200 && r.file === 200 && r.pages === 8).length;
    check(ok === students.length, `all ${students.length} students get the full 8-page file`, results.filter((r) => r.pages !== 8).slice(0, 3));
    const built = fs.readdirSync(BUNDLE_DIR).filter((n) => n.startsWith(String(rush._id)) && n.endsWith('.pdf'));
    check(built.length === 1, 'built exactly once', built);
  }

  // ── Clean up everything this run wrote into the local uploads folder ──
  for (const f of written) fs.rmSync(path.join(PROTECTED_MEDIA_DIR, f), { force: true });
  const topicIds = (await BookTopic.find().select('_id').lean()).map((t: any) => String(t._id));
  for (const n of fs.existsSync(BUNDLE_DIR) ? fs.readdirSync(BUNDLE_DIR) : []) {
    if (topicIds.some((id) => n.startsWith(id))) fs.rmSync(path.join(BUNDLE_DIR, n), { force: true });
  }

  await mongoose.disconnect();
  await mongod.stop();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
