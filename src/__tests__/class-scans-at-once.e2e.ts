/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * A whole class scans the same topic at the same moment, then opens its PDF and
 * figures (isolated in-memory MongoDB, the real Express app on a real socket;
 * never the live DB).
 *
 * This is the complaint as the client put it: "when many students go in at
 * once, the topic PDFs and pictures stop working". Every request is sent the
 * way production delivers it — through the shop's Next proxy, so Express sees
 * one address (the Next container) for everyone, and proxy.ts names the real
 * student in x-mv-client-ip.
 *
 * Each student:
 *   1. scans the QR           GET /api/book-content/scan/CLASS001
 *   2. opens the answer PDF   the attachment URL the scan handed back (?t=…)
 *   3. pages through it       a Range request, as the PDF viewer does
 *   4. sees the figures       the .thumb.webp tile and the .view.webp enlargement
 *
 * Run on the old code this shows thirty students getting the topic and the
 * rest a "Too many scans" error — so they never see a single PDF or picture.
 *
 * Run:  npx ts-node --transpile-only src/__tests__/class-scans-at-once.e2e.ts
 *       (CLASS_SIZE=… to change the head count; PDF_FILE=… for a real PDF)
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { AddressInfo } from 'net';
import { Buffer } from 'buffer';

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

const CLASS_SIZE = Number(process.env.CLASS_SIZE) || 60;
const NEXT_HOP = '10.0.1.7'; // what Express sees for every visitor in production

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
  process.env.CLIENT_URL = 'https://magicviva.com';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { Book } = await import('../app/modules/book/book.model');
  const { BookPart, BookChapter, BookTopic, BookQuestion } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { BookAccess } = await import('../app/modules/bookAccess/bookAccess.model');
  const { PROTECTED_MEDIA_DIR } = await import('../app/config/localUpload');
  const { makeVariants } = await import('../app/modules/bookContent/mediaVariants');

  // ── The topic's media, as an admin upload would leave it on disk ──
  const stamp = Date.now();
  const PDF = `${stamp}-class-test-answer.pdf`;
  const FIG = [`${stamp}-class-test-fig1.jpg`, `${stamp}-class-test-fig2.jpg`];
  const written: string[] = [];
  fs.mkdirSync(PROTECTED_MEDIA_DIR, { recursive: true });

  const pdfSource = process.env.PDF_FILE;
  const pdfBody = pdfSource && fs.existsSync(pdfSource)
    ? fs.readFileSync(pdfSource)
    : Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024, 7)]); // a 3 MB stand-in
  fs.writeFileSync(path.join(PROTECTED_MEDIA_DIR, PDF), pdfBody);
  written.push(PDF);
  for (const name of FIG) {
    // A phone photo of a book page: big, as the admins upload them.
    await sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#d9cbb0' } })
      .jpeg({ quality: 90 })
      .toFile(path.join(PROTECTED_MEDIA_DIR, name));
    await makeVariants(PROTECTED_MEDIA_DIR, name); // done at upload time in production
    written.push(name, `${name}.thumb.webp`, `${name}.view.webp`);
  }

  const book = await Book.create({
    id: 1, title: 'Anatomy MAGIC VIVA', slug: 'anatomy-magic-viva', price: 650,
    author: 'S', category: 'medical', description: 'x', format: 'printed',
  });
  const part = await BookPart.create({ bookId: book._id, title: 'Board I', order: 1 });
  const chapter = await BookChapter.create({
    bookId: book._id, partId: part._id, title: 'Head and Neck', order: 1, isFree: false,
  });
  const topic = await BookTopic.create({
    bookId: book._id, partId: part._id, chapterId: chapter._id, title: 'Scalp', order: 1, qrCode: 'CLASS001',
  });
  const media = (f: string) => `https://magicviva.com/api/book-content/media/${f}`;
  await BookQuestion.create({
    bookId: book._id, chapterId: chapter._id, topicId: topic._id, questionNo: '1', order: 1,
    questionText: 'Layers of the scalp',
    answerHtml: `<p>See figure</p><img src="${media(FIG[0])}">`,
    images: FIG.map(media),
    attachments: [{ title: 'Scalp — full answer', fileUrl: media(PDF), fileType: 'pdf', fileSize: pdfBody.length }],
  });

  // A class that has all activated their books.
  const students = Array.from({ length: CLASS_SIZE }, (_, i) => ({
    id: new mongoose.Types.ObjectId(),
    ip: `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`,
  }));
  await BookAccess.insertMany(students.map((s) => ({ userId: s.id, bookId: book._id, source: 'manual' })));

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const http = () => request(`http://127.0.0.1:${port}`);
  const viaShop = (r: request.Test, ip: string) => r.set('X-Forwarded-For', NEXT_HOP).set('x-mv-client-ip', ip);
  const pathOf = (url: string) => url.replace('https://magicviva.com', '');

  console.log(`\n— ${CLASS_SIZE} students scan the same QR at the same moment, then open its PDF and figures`);
  console.log(`  (PDF ${(pdfBody.length / 1024 / 1024).toFixed(1)} MB, two figures, all through "the shop's proxy")`);

  const t0 = Date.now();
  const results = await Promise.all(
    students.map(async (s) => {
      const token = jwt.sign({ _id: String(s.id), role: 'student' }, 'test_access_secret', { expiresIn: '1h' });
      const out = { scan: 0, pdf: 0, pdfBytes: 0, range: 0, thumbs: 0, views: 0, message: '' };

      const scan = await viaShop(http().get('/api/book-content/scan/CLASS001'), s.ip).set('Authorization', `Bearer ${token}`);
      out.scan = scan.status;
      if (scan.status !== 200) {
        out.message = scan.body?.message || '';
        return out; // the page shows an error — no PDF, no pictures
      }
      const q = scan.body.data.questions[0];

      const pdfUrl = pathOf(q.attachments[0].fileUrl);
      const pdf = await viaShop(http().get(pdfUrl), s.ip).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      out.pdf = pdf.status;
      out.pdfBytes = Buffer.isBuffer(pdf.body) ? pdf.body.length : 0;

      const range = await viaShop(http().get(pdfUrl), s.ip).set('Range', 'bytes=262144-524287');
      out.range = range.status;

      for (const img of q.images as string[]) {
        const [base, query] = pathOf(img).split('?');
        const thumb = await viaShop(http().get(`${base}.thumb.webp?${query}`), s.ip);
        const view = await viaShop(http().get(`${base}.view.webp?${query}`), s.ip);
        if (thumb.status === 200) out.thumbs++;
        if (view.status === 200) out.views++;
      }
      return out;
    })
  );
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const opened = results.filter((r) => r.scan === 200).length;
  const blocked = results.filter((r) => r.scan === 429);
  const gotPdf = results.filter((r) => r.pdf === 200 && r.pdfBytes === pdfBody.length).length;
  const paged = results.filter((r) => r.range === 206).length;
  const allFigures = results.filter((r) => r.thumbs === FIG.length && r.views === FIG.length).length;

  console.log(`  topic opened: ${opened}/${CLASS_SIZE}   blocked: ${blocked.length}${blocked[0] ? ` ("${blocked[0].message}")` : ''}`);
  console.log(`  whole PDF:    ${gotPdf}/${CLASS_SIZE}   PDF page fetch (206): ${paged}/${CLASS_SIZE}   all figures: ${allFigures}/${CLASS_SIZE}`);
  console.log(`  everyone done in ${seconds}s`);

  check(opened === CLASS_SIZE, 'every student gets the topic', { opened, blocked: blocked.length });
  check(gotPdf === CLASS_SIZE, 'every student gets the whole PDF, byte for byte', gotPdf);
  check(paged === CLASS_SIZE, 'every student can page through it (Range → 206)', paged);
  check(allFigures === CLASS_SIZE, 'every student sees every figure, tile and enlargement', allFigures);

  // ── Clean up the files this run wrote into the local uploads folder ──
  server.close();
  for (const f of written) {
    try {
      fs.unlinkSync(path.join(PROTECTED_MEDIA_DIR, f));
    } catch {
      /* already gone */
    }
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
