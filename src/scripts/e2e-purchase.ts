/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * e2e-purchase.ts — End-to-end PURCHASE / money-flow test against the LIVE
 * Sabbir Book backend. It drives the exact HTTP endpoints the checkout UI uses
 * and asserts each money-flow step actually works.
 *
 * Run (server must already be running on :5000, with seeded medical data):
 *   cd server && npx ts-node --transpile-only src/scripts/e2e-purchase.ts
 *
 * It is IDEMPOTENT — reuses the test student if it already exists (register
 * tolerates 409) and tolerates an already-active course enrollment on re-runs.
 * Uses global `fetch` (Node 18+).
 *
 * Flow covered:
 *   1. Register test student            POST /api/auth/register        (409 ok)
 *   2. Login (x-device-id header)       POST /api/auth/login           → accessToken
 *   3. Paid course enrol (bKash demo)   POST /api/payment/bkash/initiate
 *                                       POST /api/payment/bkash/demo-complete
 *                                       GET  /api/enrollments/my-enrollments
 *   4. Digital book order               POST /api/orders → pay/bkash → pay/complete
 *                                       GET  /api/orders/my   (assert paid)
 *                                       GET  /api/orders/:id/download/:bookId
 *   5. Printed book order               POST /api/orders (no address → REJECT)
 *                                       POST /api/orders (with address → OK)
 *                                       pay/complete (assert processing + stock--)
 */

const BASE = process.env.E2E_API_BASE || 'http://localhost:5000';
const DEVICE_ID = 'e2e-device-1';

const STUDENT = {
  firstName: 'Test',
  lastName: 'Student',
  email: 'test-student@sabbirbook.com',
  phoneNumber: '+8801799999999',
  password: 'Test@1234',
};

const SHIPPING = {
  name: 'Test Student',
  phone: '+8801799999999',
  address: '123 Medical College Road, Dhanmondi',
  city: 'Dhaka',
  note: 'E2E printed order test',
};

type ApiRes = { status: number; ok: boolean; body: any };

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: any } = {},
): Promise<ApiRes> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-device-id': DEVICE_ID,
  };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

// ── price string → number (course fee/offerPrice are stored as strings) ──
const priceNum = (v: any): number =>
  typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;

// ── Result accounting ────────────────────────────────────────
type Row = { step: string; name: string; pass: boolean; detail: string };
const rows: Row[] = [];
const fixes: string[] = [];
const bugs: string[] = [];

function record(step: string, name: string, pass: boolean, detail: string) {
  rows.push({ step, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${step}] ${name} — ${detail}`);
}

// ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== E2E PURCHASE TEST → ${BASE} ===\n`);

  // ── STEP 1: REGISTER ───────────────────────────────────────
  const reg = await api('POST', '/api/auth/register', { body: STUDENT });
  if (reg.status === 201) {
    record('1', 'Register student', true, `201 created (${STUDENT.email})`);
  } else if (reg.status === 409) {
    record('1', 'Register student', true, `409 already exists → reusing (${STUDENT.email})`);
  } else {
    record('1', 'Register student', false, `unexpected ${reg.status}: ${JSON.stringify(reg.body)}`);
  }

  // ── STEP 2: LOGIN ──────────────────────────────────────────
  const login = await api('POST', '/api/auth/login', {
    body: { email: STUDENT.email, password: STUDENT.password },
  });
  const token: string | undefined = login.body?.data?.accessToken;
  const role = login.body?.data?.user?.role;
  if (login.ok && token) {
    record('2', 'Login (accessToken)', true, `200, role='${role}', token acquired`);
  } else {
    record('2', 'Login (accessToken)', false, `${login.status}: ${JSON.stringify(login.body)}`);
    console.log('\nCannot continue without a student access token. Aborting.');
    return finish();
  }

  // ── STEP 3: PAID COURSE ENROLLMENT (bKash demo) ───────────
  const coursesRes = await api('GET', '/api/courses?limit=100');
  const courses: any[] = coursesRes.body?.data || [];
  const paidCourse = courses.find((c) => priceNum(c.fee) > 0);
  if (!paidCourse) {
    record('3', 'Course enrol (bKash)', false, 'no course with a positive fee found in /api/courses');
  } else {
    const courseId = paidCourse._id;
    const fee = priceNum(paidCourse.fee);
    console.log(`  course: "${paidCourse.title}" _id=${courseId} fee=${fee}`);

    // 3a. initiate → creates pending enrollment + returns paymentID
    const initiate = await api('POST', '/api/payment/bkash/initiate', {
      token,
      body: { courseId, amount: fee, totalFee: fee },
    });
    const paymentID: string | undefined = initiate.body?.data?.paymentID;
    console.log(`  initiate → ${initiate.status} paymentID=${paymentID}`);

    // 3b. demo-complete → marks enrollment active (verifyPayment)
    const demo = await api('POST', '/api/payment/bkash/demo-complete', {
      token,
      body: { paymentID, courseId, amount: fee, totalFee: fee },
    });
    const demoOk = demo.ok;
    const alreadyEnrolled = /already enrolled/i.test(demo.body?.message || '');
    console.log(
      `  demo-complete → ${demo.status} ${demo.body?.message || ''}` +
        (alreadyEnrolled ? ' (already active from a prior run — tolerated)' : ''),
    );

    // 3c. my-enrollments → assert course present + active
    const mine = await api('GET', '/api/enrollments/my-enrollments', { token });
    const enrollments: any[] = mine.body?.data || [];
    const found = enrollments.find((e) => String(e.courseId?._id || e.courseId) === String(courseId));
    const pass = !!found && (found.status === 'active' || found.payment?.status === 'paid');
    record(
      '3',
      'Course enrol (bKash) → my-enrollments',
      pass,
      pass
        ? `enrollment present: count=${enrollments.length}, status='${found.status}', payment='${found.payment?.status}'` +
            (demoOk ? '' : ' (demo-complete non-2xx but end-state active)')
        : `course NOT active in my-enrollments (count=${enrollments.length}); demo=${demo.status} ${demo.body?.message || ''}`,
    );
    if (!demoOk && !alreadyEnrolled) {
      bugs.push(`bKash demo-complete returned ${demo.status}: ${demo.body?.message}`);
    }
  }

  // ── STEP 4: DIGITAL BOOK ORDER ─────────────────────────────
  const booksRes = await api('GET', '/api/books?limit=200');
  const books: any[] = booksRes.body?.data || [];
  const digitalBooks = books.filter((b) => b.format === 'digital');
  if (digitalBooks.length === 0) {
    record('4', 'Digital book order', false, 'no digital book found in /api/books');
  } else {
    // Try digital books until one yields a downloadable secureFileUrl.
    let done = false;
    for (const book of digitalBooks) {
      const slug = book.slug;
      // 4a. create order
      const create = await api('POST', '/api/orders', {
        token,
        body: { items: [{ bookSlugOrId: slug, quantity: 1 }] },
      });
      if (!create.ok) {
        record('4', 'Digital book order (create)', false, `${create.status}: ${JSON.stringify(create.body)}`);
        break;
      }
      const order = create.body.data;
      const orderId = order._id;
      const bookId = order.items?.[0]?.book;
      console.log(
        `  digital order: "${book.title}" order=${order.orderNumber} id=${orderId} bookId=${bookId} total=${order.total} status=${order.status}`,
      );

      // 4b. pay via bKash (init) then complete
      const payInit = await api('POST', `/api/orders/${orderId}/pay/bkash`, { token });
      console.log(`  pay/bkash → ${payInit.status} paymentID=${payInit.body?.data?.paymentID}`);
      const complete = await api('POST', `/api/orders/${orderId}/pay/complete`, {
        token,
        body: { method: 'bkash' },
      });
      const paidOrder = complete.body?.data;
      const paidOk =
        complete.ok &&
        paidOrder?.payment?.status === 'paid' &&
        paidOrder?.status === 'access-granted';
      console.log(
        `  pay/complete → ${complete.status} status='${paidOrder?.status}' payment='${paidOrder?.payment?.status}'`,
      );

      // 4c. my orders → assert paid + access-granted
      const myOrders = await api('GET', '/api/orders/my', { token });
      const mo = (myOrders.body?.data || []).find((o: any) => String(o._id) === String(orderId));
      const myPaid = mo?.payment?.status === 'paid' && mo?.status === 'access-granted';

      // 4d. download → assert secureFileUrl present
      const dl = await api('GET', `/api/orders/${orderId}/download/${bookId}`, { token });
      const secureUrl = dl.body?.data?.secureFileUrl;
      if (!dl.ok && /secure file not available/i.test(dl.body?.message || '')) {
        console.log(`  download for "${book.title}" has no secure file → trying next digital book`);
        continue; // this book lacks a seeded secureFileUrl; try another
      }

      const pass = paidOk && myPaid && !!secureUrl;
      record(
        '4',
        'Digital book: order → pay → download',
        pass,
        pass
          ? `order ${order.orderNumber} paid (status='${mo.status}'), download URL present: ${secureUrl}`
          : `paidOk=${paidOk} myPaid=${myPaid} downloadStatus=${dl.status} url=${secureUrl || 'MISSING'} msg=${dl.body?.message || ''}`,
      );
      done = true;
      break;
    }
    if (!done && !rows.some((r) => r.step === '4')) {
      record('4', 'Digital book order', false, 'no digital book produced a downloadable secureFileUrl');
    }
  }

  // ── STEP 5: PRINTED BOOK ORDER ─────────────────────────────
  const printedBooks = books.filter((b) => b.format === 'printed' && (b.stock ?? 0) > 0);
  if (printedBooks.length === 0) {
    record('5', 'Printed book order', false, 'no in-stock printed book found in /api/books');
  } else {
    const pbook = printedBooks[0];
    const slug = pbook.slug;

    // fresh stock BEFORE
    const before = await api('GET', `/api/books/${slug}`);
    const stockBefore = before.body?.data?.stock ?? pbook.stock;
    console.log(`  printed book: "${pbook.title}" slug=${slug} stockBefore=${stockBefore}`);

    // 5a. create WITHOUT shipping address → must be REJECTED
    const noAddr = await api('POST', '/api/orders', {
      token,
      body: { items: [{ bookSlugOrId: slug, quantity: 1 }] },
    });
    const rejected = !noAddr.ok && noAddr.status === 400;
    record(
      '5a',
      'Printed order WITHOUT address rejected',
      rejected,
      rejected
        ? `correctly rejected: ${noAddr.status} "${noAddr.body?.message}"`
        : `NOT rejected: ${noAddr.status} ${JSON.stringify(noAddr.body)}`,
    );
    if (!rejected) bugs.push('Printed order without shippingAddress was NOT rejected (validation gap).');

    // 5b. create WITH shipping address → must SUCCEED
    const withAddr = await api('POST', '/api/orders', {
      token,
      body: { items: [{ bookSlugOrId: slug, quantity: 1 }], shippingAddress: SHIPPING },
    });
    if (!withAddr.ok) {
      record('5b', 'Printed order WITH address', false, `${withAddr.status}: ${JSON.stringify(withAddr.body)}`);
    } else {
      const order = withAddr.body.data;
      const orderId = order._id;
      console.log(`  printed order created: ${order.orderNumber} id=${orderId} deliveryType=${order.deliveryType}`);
      record('5b', 'Printed order WITH address', true, `created ${order.orderNumber} (status='${order.status}')`);

      // 5c. pay/bkash + pay/complete → status 'processing', stock decremented
      await api('POST', `/api/orders/${orderId}/pay/bkash`, { token });
      const complete = await api('POST', `/api/orders/${orderId}/pay/complete`, {
        token,
        body: { method: 'bkash' },
      });
      const paidOrder = complete.body?.data;
      const processingOk =
        complete.ok &&
        paidOrder?.payment?.status === 'paid' &&
        paidOrder?.status === 'processing';
      console.log(
        `  pay/complete → ${complete.status} status='${paidOrder?.status}' payment='${paidOrder?.payment?.status}'`,
      );

      // fresh stock AFTER
      const after = await api('GET', `/api/books/${slug}`);
      const stockAfter = after.body?.data?.stock;
      const stockOk = typeof stockAfter === 'number' && stockAfter === stockBefore - 1;

      record(
        '5c',
        'Printed order paid → processing + stock--',
        processingOk && stockOk,
        `status='${paidOrder?.status}' payment='${paidOrder?.payment?.status}', stock ${stockBefore} → ${stockAfter} (expected ${stockBefore - 1})`,
      );
      if (!stockOk) bugs.push(`Printed stock not decremented correctly: ${stockBefore} → ${stockAfter}`);
    }
  }

  finish();
}

function finish() {
  console.log('\n============ RESULT TABLE ============');
  const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
  console.log(`${pad('STEP', 6)}${pad('RESULT', 8)}NAME / DETAIL`);
  console.log('-'.repeat(70));
  for (const r of rows) {
    console.log(`${pad(r.step, 6)}${pad(r.pass ? 'PASS' : 'FAIL', 8)}${r.name}`);
    console.log(`${' '.repeat(14)}${r.detail}`);
  }
  const passed = rows.filter((r) => r.pass).length;
  const total = rows.length;
  console.log('-'.repeat(70));
  console.log(`TOTAL: ${passed}/${total} passed`);
  if (fixes.length) {
    console.log('\nPayload fixes applied:');
    fixes.forEach((f) => console.log(`  - ${f}`));
  }
  if (bugs.length) {
    console.log('\nBugs / anomalies found:');
    bugs.forEach((b) => console.log(`  - ${b}`));
  } else {
    console.log('\nNo server-side bugs detected.');
  }
  console.log('\nDone.\n');
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL:', err?.stack || err?.message || err);
  process.exit(1);
});
