/* eslint-disable no-console */
/**
 * SMS — who gets a text, when, and how many (isolated in-memory MongoDB, real
 * Express app via supertest — never touches the live DB or the real gateway).
 *
 * The rules being pinned down:
 *   COD        → placed (at once) → confirmed (admin) → delivered   = 3
 *   prepaid    → paid (money lands, which confirms it) → delivered  = 2
 *   affiliate  → one text on approval, and never another
 *   cancelled  → silence
 *   repeats    → an admin clicking a status twice sends one text
 *   length     → every template fits one 160-character SMS
 *
 * The gateway is stubbed by leaving SMS_API_KEY unset — sms.service's demo mode
 * is derived from config, so the real send path is exercised right up to the
 * fetch and then logged instead. The console line is what this asserts on,
 * which is also what an admin would read when debugging a missing text.
 *
 * Run:  npx ts-node src/__tests__/sms.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

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

/**
 * Everything the SMS layer logged, captured so a test can ask "was a text sent,
 * to whom, saying what?" without a gateway or a mock framework.
 */
interface SentSms {
  to: string;
  body: string;
}
const sent: SentSms[] = [];

const captureConsole = () => {
  const realLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    // 📱 [DEMO SMS — …] To: 8801…\n<message>
    const m = /\[DEMO SMS[^\]]*\] To: (\d+)\n([\s\S]*)$/.exec(line);
    if (m) sent.push({ to: m[1], body: m[2] });
    else realLog(...args);
  };
  return () => { console.log = realLog; };
};

/**
 * Texts sent to a number, looked up the way the gateway stores it.
 *
 * The test writes numbers the way a buyer types them (01711110001) and the
 * service normalises them (8801711110001), so the lookup normalises too rather
 * than hand-building the prefix — a hand-built prefix is its own bug.
 */
let normalize: (s: string) => string = (s) => s;
const textsFor = (phone: string) => sent.filter((s) => s.to === normalize(phone));

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.SHOP_NAME = 'Magic Viva';
  // Deliberately unset: demo mode is what makes this test possible.
  delete process.env.SMS_API_KEY;
  delete process.env.SMS_USERNAME;

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Book } = await import('../app/modules/book/book.model');
  const { Order } = await import('../app/modules/order/order.model');
  const { User } = await import('../app/modules/user/user.model');
  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const { SmsService } = await import('../app/modules/notification/sms.service');
  const { SmsMessage, SMS_SINGLE_PART } = await import('../app/modules/notification/sms.message');

  const api = () => request(app);
  normalize = SmsService.normalizePhone;
  const restoreConsole = captureConsole();

  // ── Fixtures ──────────────────────────────────────────────
  const dmc = await MedicalCollege.create({
    name: 'Dhaka Medical College',
    searchKey: 'dhaka medical college',
    type: 'government',
    division: 'ঢাকা',
    district: 'ঢাকা',
  });

  await Book.create({
    id: 1,
    title: 'Anatomy MAGIC VIVA',
    slug: 'anatomy-magic-viva',
    price: 500,
    author: 'Sabbir',
    category: 'medical',
    description: 'test',
    format: 'printed',
    stock: 100,
  });

  const registerLogin = async (email: string, device: string, role?: string) => {
    await api().post('/api/auth/register').send({
      firstName: 'T', lastName: 'U', email, password: 'pass1234', whatsappNumber: '01712345678',
    });
    if (role) await User.updateOne({ email }, { role });
    const r = await api().post('/api/auth/login').set('x-device-id', device)
      .send({ email, password: 'pass1234' });
    return r.body?.data?.accessToken as string;
  };

  const admin = await registerLogin('sms-admin@test.com', 'ad1', 'superAdmin');

  const buyerToken = await registerLogin('sms-buyer@test.com', 'by1');
  await User.updateOne(
    { email: 'sms-buyer@test.com' },
    { medicalCollege: dmc._id, medicalCollegeName: 'Dhaka Medical College' }
  );

  const placeOrder = async (phone: string, paymentMethod: string) => {
    const r = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        shippingAddress: { name: 'Buyer', phone, address: 'Rd 5', city: 'Dhaka' },
        paymentMethod,
        medicalCollegeName: 'Dhaka Medical College',
      });
    return { status: r.status, id: r.body?.data?._id, body: r.body };
  };

  const setStatus = (id: string, status: string) =>
    api().patch(`/api/orders/${id}/status`).set('Authorization', `Bearer ${admin}`).send({ status });

  // ───────────────────────────────────────────────────────────
  console.log('\n── A phone number is a phone number however it is typed ──');
  {
    const n = SmsService.normalizePhone;
    check(n('01712345678') === '8801712345678', `01712345678 → 8801712345678 (${n('01712345678')})`);
    check(n('+8801712345678') === '8801712345678', 'a +88 prefix is accepted');
    check(n('0171-234 5678') === '8801712345678', 'dashes and spaces are ignored');
    check(n('008801712345678') === '8801712345678', 'the 0088 international form works');
    check(n('1712345678') === '8801712345678', 'a dropped leading zero is restored');
    check(n('') === '', 'nothing is not a number');
    check(n('12345') === '', 'and neither is a short one');
    check(n('01212345678') === '', 'an invalid operator prefix is refused, not guessed');
  }

  console.log('\n── Every template fits one 160-character SMS ──');
  {
    const o = { shopName: 'Magic Viva', siteUrl: 'magicviva.com', orderNumber: 'ORD-1788284255628-LKB6BR', total: 1220 };
    const a = {
      shopName: 'Magic Viva',
      // The longest a generated code realistically gets: abbreviation + name +
      // "20" + the two-digit suffix a clash adds.
      couponCode: 'AFMCFARHANA2066',
      discountTk: 20, payoutTk: 30, siteUrl: 'magicviva.com',
    };
    const all: [string, string][] = [
      ['orderPlaced', SmsMessage.orderPlaced(o)],
      ['paymentReceived', SmsMessage.paymentReceived(o)],
      ['orderConfirmed', SmsMessage.orderConfirmed(o)],
      ['orderDelivered', SmsMessage.orderDelivered(o)],
      ['affiliateApproved', SmsMessage.affiliateApproved(a)],
    ];
    for (const [name, body] of all) {
      check(body.length <= SMS_SINGLE_PART, `${name} is ${body.length} chars — one message`);
      check(body.split('\n').length === 3, `${name} is three lines`);
      // A single Bengali character would force UCS-2 and cut the limit to 70.
      check(!/[^\x20-\x7E\n]/.test(body), `${name} is plain ASCII, so it bills as GSM-7`);
    }
  }

  console.log('\n── Cash on delivery: three texts, in order ──');
  const COD_PHONE = '01711110001';
  let codOrderId = '';
  {
    const placed = await placeOrder(COD_PHONE, 'cod');
    check(placed.status === 201, `order placed (${placed.status})`, placed.body?.message);
    codOrderId = placed.id;
    await new Promise((r) => setTimeout(r, 300)); // the send is fire-and-forget

    const texts = textsFor(COD_PHONE);
    check(texts.length === 1, `1 text so far (${texts.length})`);
    check(/received/i.test(texts[0]?.body || ''), 'it says the order was received');
    check(
      !/confirmed/i.test(texts[0]?.body || ''),
      'and does NOT claim it is confirmed — a person has not looked at it yet'
    );
    check(texts[0]?.body.includes('Magic Viva'), 'with the shop name on it');
  }

  {
    await setStatus(codOrderId, 'processing');
    await new Promise((r) => setTimeout(r, 300));

    const texts = textsFor(COD_PHONE);
    check(texts.length === 2, `confirming sends the second text (${texts.length})`);
    check(/confirmed/i.test(texts[1]?.body || ''), 'which says it is confirmed');
    check(
      /cash on delivery/i.test(texts[1]?.body || ''),
      'and names the amount to have ready'
    );
  }

  {
    await setStatus(codOrderId, 'delivered');
    await new Promise((r) => setTimeout(r, 300));

    const texts = textsFor(COD_PHONE);
    check(texts.length === 3, `delivering sends the third (${texts.length})`);
    check(/delivered/i.test(texts[2]?.body || ''), 'which says it arrived');
    check(/code/i.test(texts[2]?.body || ''), 'and tells them the book has a code inside — the only way in now');
  }

  console.log('\n── Clicking a status twice does not text twice ──');
  {
    const before = textsFor(COD_PHONE).length;
    await setStatus(codOrderId, 'shipped');
    await setStatus(codOrderId, 'delivered');
    await setStatus(codOrderId, 'delivered');
    await new Promise((r) => setTimeout(r, 400));

    const after = textsFor(COD_PHONE).length;
    check(after === before, `still ${before} texts after three more clicks (${after})`);

    const o: any = await Order.findById(codOrderId).lean();
    check(
      JSON.stringify([...o.smsSent].sort()) === JSON.stringify(['confirmed', 'delivered', 'placed']),
      `the order records what it sent (${JSON.stringify(o.smsSent)})`
    );
  }

  console.log('\n── Paid online: two texts, and never the COD pair ──');
  const PREPAID_PHONE = '01711110002';
  let prepaidOrderId = '';
  {
    // 'manual' — a bank or Send-Money transfer an admin then approves. It is
    // the prepaid path this endpoint accepts (a card/bKash checkout is created
    // by the gateway routes), and it settles through the same
    // applyPaidSideEffects that a gateway callback does, which is the code
    // under test here.
    const placed = await placeOrder(PREPAID_PHONE, 'manual');
    check(placed.status === 201, `prepaid order created (${placed.status})`, placed.body?.message);
    prepaidOrderId = placed.id;
    await new Promise((r) => setTimeout(r, 300));

    // Nothing yet, on purpose: the buyer may close the payment page. This is the
    // same rule the admin alerts follow, and the reason the pending queue no
    // longer fills with orders that were never orders.
    check(
      textsFor(PREPAID_PHONE).length === 0,
      'no text before the money lands — an abandoned checkout costs nothing'
    );
  }

  {
    // The money arrives, however it arrives — here, an admin approving it.
    const approved = await api()
      .post(`/api/orders/${prepaidOrderId}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});
    check(approved.status === 200, `the payment is approved (${approved.status})`, approved.body?.message);
    await new Promise((r) => setTimeout(r, 400));

    const texts = textsFor(PREPAID_PHONE);
    check(texts.length === 1, `paying sends exactly one text (${texts.length})`);
    check(/payment of/i.test(texts[0]?.body || ''), 'a payment receipt');
    check(
      /confirmed/i.test(texts[0]?.body || ''),
      'that also confirms the order — so no separate confirm text is owed'
    );
  }

  {
    await setStatus(prepaidOrderId, 'delivered');
    await new Promise((r) => setTimeout(r, 300));

    const texts = textsFor(PREPAID_PHONE);
    check(texts.length === 2, `two in total for a prepaid buyer (${texts.length})`);
    check(/delivered/i.test(texts[1]?.body || ''), 'the second being delivery');

    const o: any = await Order.findById(prepaidOrderId).lean();
    check(!o.smsSent.includes('placed'), 'never the "order received" text');
    check(!o.smsSent.includes('confirmed'), 'and never the COD confirm text');
  }

  console.log('\n── A cancelled order says nothing ──');
  {
    const CANCEL_PHONE = '01711110003';
    const placed = await placeOrder(CANCEL_PHONE, 'cod');
    await new Promise((r) => setTimeout(r, 300));
    const afterPlace = textsFor(CANCEL_PHONE).length;
    check(afterPlace === 1, `the placed text went out (${afterPlace})`);

    await setStatus(placed.id, 'cancelled');
    await new Promise((r) => setTimeout(r, 300));
    check(
      textsFor(CANCEL_PHONE).length === 1,
      'and cancelling adds nothing — there is no cheerful text for this'
    );
  }

  console.log('\n── An affiliate gets one text, on approval, and no more ──');
  {
    const AFF_PHONE = '01711110004';
    const created = await api()
      .post('/api/ambassador')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        fullName: 'Md Sakib Hasan',
        phone: AFF_PHONE,
        email: 'aff-sms@test.com',
        medicalCollege: String(dmc._id),
      });
    check(created.status === 201, `affiliate added (${created.status})`, created.body?.message);
    await new Promise((r) => setTimeout(r, 400));

    const to = AFF_PHONE;
    const texts = textsFor(to);
    check(texts.length === 1, `one text on approval (${texts.length})`);
    check(/affiliate/i.test(texts[0]?.body || ''), 'telling them they are an affiliate');
    check(texts[0]?.body.includes('DMCSAKIB20'), `carrying their code (${texts[0]?.body?.split('\n')[1]})`);
    check(/BDT 30/.test(texts[0]?.body || ''), 'and what they earn per sale');

    const id = created.body?.data?._id;

    // Editing them must not re-announce anything.
    await api().patch(`/api/ambassador/${id}`).set('Authorization', `Bearer ${admin}`)
      .send({ city: 'Dhaka' });
    await new Promise((r) => setTimeout(r, 300));
    check(textsFor(to).length === 1, 'editing them sends nothing');

    // Nor does suspending — that is a conversation, not an automated text.
    await api().patch(`/api/ambassador/${id}/status`).set('Authorization', `Bearer ${admin}`)
      .send({ status: 'suspended' });
    await new Promise((r) => setTimeout(r, 300));
    check(textsFor(to).length === 1, 'suspending them sends nothing');

    // But bringing a suspended affiliate back does: their code works again.
    await api().patch(`/api/ambassador/${id}/status`).set('Authorization', `Bearer ${admin}`)
      .send({ status: 'approved' });
    await new Promise((r) => setTimeout(r, 400));
    check(
      textsFor(to).length === 2,
      `re-approving does text again — their code is live once more (${textsFor(to).length})`
    );
  }

  console.log('\n── A refused send can be tried again ──');
  {
    // What actually happened on the first live day: the account's IP was not
    // whitelisted, every send was refused, and the orders were left marked as
    // if they had been texted — so fixing the gateway would not have rescued
    // them. The claim now goes back when the send does not happen.
    const { OrderSmsService } = await import('../app/modules/notification/orderSms.service');
    const { SmsService: Sms } = await import('../app/modules/notification/sms.service');

    const RETRY_PHONE = '01711110005';
    const placed = await placeOrder(RETRY_PHONE, 'cod');
    await new Promise((r) => setTimeout(r, 300));
    check(textsFor(RETRY_PHONE).length === 1, 'the first text went out normally');

    const order: any = await Order.findById(placed.id);

    // Stand in for a refusing gateway.
    const realSend = Sms.send;
    (Sms as any).send = async () => ({ success: false, error: 'IP Black List.' });

    const before = sent.length;
    await OrderSmsService.send(order, 'delivered');
    check(sent.length === before, 'a refused send delivers nothing');

    const afterFail: any = await Order.findById(placed.id).lean();
    check(
      !afterFail.smsSent.includes('delivered'),
      `and does NOT leave the order marked as texted (${JSON.stringify(afterFail.smsSent)})`
    );

    // Gateway comes back.
    (Sms as any).send = realSend;
    await OrderSmsService.send(order, 'delivered');
    await new Promise((r) => setTimeout(r, 200));

    check(textsFor(RETRY_PHONE).length === 2, 'so the same event goes through once it works');
    const afterOk: any = await Order.findById(placed.id).lean();
    check(afterOk.smsSent.includes('delivered'), 'and only then is it marked sent');

    // And it is still sent exactly once.
    await OrderSmsService.send(order, 'delivered');
    await new Promise((r) => setTimeout(r, 200));
    check(textsFor(RETRY_PHONE).length === 2, 'a third attempt after success still sends nothing');
  }

  console.log('\n── An order with no phone number is skipped, not crashed ──');
  {
    const before = sent.length;
    const r = await api()
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [{ bookSlugOrId: 'anatomy-magic-viva', quantity: 1 }],
        shippingAddress: { name: 'Buyer', phone: 'not-a-number', address: 'Rd 5', city: 'Dhaka' },
        paymentMethod: 'cod',
        medicalCollegeName: 'Dhaka Medical College',
      });
    await new Promise((r2) => setTimeout(r2, 300));
    check(r.status === 201, `the order is still placed (${r.status})`);
    check(sent.length === before, 'and no garbage went to the gateway');
  }

  restoreConsole();
  await mongoose.disconnect();
  await mongod.stop();

  console.log(
    failed === 0
      ? `\n✅ ALL PASS — ${passed} passed, 0 failed`
      : `\n❌ FAILURES — ${passed} passed, ${failed} failed`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});
