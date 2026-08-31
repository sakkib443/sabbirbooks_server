/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pre-ordering and address geography.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the live database, and a test that placed orders
 * there would bill real customers. DATABASE_URL is overwritten with the memory
 * server's URI before a single module is imported, so even a module that
 * connects on import cannot reach production.
 *
 * Run: npx ts-node src/__tests__/preorder.e2e.ts
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
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
};

// Did this throw, and did it complain about the thing we expected?
const rejects = async (fn: () => Promise<unknown>, needle: string) => {
  try {
    await fn();
    return { threw: false, message: '' };
  } catch (e: any) {
    return { threw: true, message: String(e?.message || e), matched: String(e?.message || e).includes(needle) };
  }
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  // Before any import: config reads DATABASE_URL at module load.
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'preorder-test' });

  const { Book } = await import('../app/modules/book/book.model');
  const { Order } = await import('../app/modules/order/order.model');
  const { Settings } = await import('../app/modules/settings/settings.model');
  const { OrderService } = await import('../app/modules/order/order.service');
  const { createBookValidationSchema, updateBookValidationSchema } = await import(
    '../app/modules/book/book.validation'
  );
  const { createOrderValidationSchema } = await import('../app/modules/order/order.validation');

  // The two zones must differ, or "which zone did it pick" is unfalsifiable —
  // the shipped defaults are 120 both ways.
  await Settings.create({
    deliveryChargeInsideDhaka: 60,
    deliveryChargeOutsideDhaka: 130,
    freeDeliveryAbove: 0,
    codExtraCharge: 0,
    codEnabled: true,
    onlinePaymentEnabled: true,
  });

  // A real User document, not a bare id: createOrder refuses an order from a
  // buyer with no medical college (it is how deliveries are routed), so a
  // stand-in id makes every order below fail for a reason unrelated to
  // pre-orders.
  const { User } = await import('../app/modules/user/user.model');
  const buyerDoc = await User.create({
    id: 'PREORDER-BUYER',
    firstName: 'Pre',
    lastName: 'Buyer',
    email: 'preorder-buyer@test.local',
    role: 'student',
    medicalCollegeName: 'Khulna Medical College',
  });
  const buyer = String(buyerDoc._id);

  await Book.create([
    // 1000tk pre-order on the default 25%.
    { id: 1, title: 'Pre-order Anatomy', slug: 'pre-anatomy', price: 1000, format: 'printed', stock: 0, isPreOrder: true },
    // Ordinary title, sold out.
    { id: 2, title: 'Sold Out Physio', slug: 'soldout-physio', price: 500, format: 'printed', stock: 0 },
    // Pre-order with a hand-set percentage.
    { id: 3, title: 'Pre-order Pharma', slug: 'pre-pharma', price: 1000, format: 'printed', stock: 0, isPreOrder: true, preOrderDiscountPercent: 40 },
    // Ordinary title, in stock — the "normal" half of a mixed cart.
    { id: 4, title: 'Stocked Biochem', slug: 'stocked-biochem', price: 400, format: 'printed', stock: 10 },
  ]);

  const addr = (extra: Record<string, unknown> = {}) => ({
    name: 'Buyer',
    phone: '01700000000',
    address: 'Road 1',
    city: 'Dhaka',
    ...extra,
  });

  const place = (payload: Record<string, unknown>) =>
    OrderService.createOrder(buyer, payload as any);

  console.log('\n── book fields survive the model + validation trio ──');

  // The brief's trap: validateRequest discards zod's output, so a field absent
  // from the schema is not stripped — it reaches Mongoose and is dropped by
  // strict mode. Asserting both halves is what catches a half-wired field.
  const bodyOk = createBookValidationSchema.safeParse({
    body: {
      title: 'Landing Page Book',
      isPreOrder: true,
      preOrderDiscountPercent: 30,
      preOrderNote: '১৫ সেপ্টেম্বর থেকে ডেলিভারি',
      expectedReleaseDate: '2026-09-15',
      promoVideoUrl: 'https://youtu.be/abc123',
      features: [{ text: 'সম্পূর্ণ বাংলায়', weight: 3, highlight: true }, { text: 'QR কোড' }],
    },
    params: {},
    query: {},
  });
  check('zod accepts every new book field', bodyOk.success, (bodyOk as any).error?.issues?.[0]);

  const patchOk = updateBookValidationSchema.safeParse({ body: { isPreOrder: true }, params: {}, query: {} });
  check('PATCH with only isPreOrder validates', patchOk.success);

  const landing: any = await Book.create({
    id: 5,
    title: 'Landing Page Book',
    slug: 'landing-page-book',
    price: 800,
    format: 'printed',
    isPreOrder: true,
    preOrderNote: '১৫ সেপ্টেম্বর থেকে ডেলিভারি',
    expectedReleaseDate: '2026-09-15',
    promoVideoUrl: 'https://youtu.be/abc123',
    features: [{ text: 'সম্পূর্ণ বাংলায়', weight: 3, highlight: true }, { text: 'QR কোড' }],
  });
  const stored: any = await Book.findById(landing._id).lean();
  check('preOrderNote persisted', stored?.preOrderNote === '১৫ সেপ্টেম্বর থেকে ডেলিভারি', { v: stored?.preOrderNote });
  check('expectedReleaseDate stored as a Date', stored?.expectedReleaseDate instanceof Date, { v: stored?.expectedReleaseDate });
  check('promoVideoUrl persisted', stored?.promoVideoUrl === 'https://youtu.be/abc123');
  check('two features persisted', stored?.features?.length === 2, { n: stored?.features?.length });
  check('feature weight + highlight kept', stored?.features?.[0]?.weight === 3 && stored?.features?.[0]?.highlight === true);
  check('feature weight defaults to 1', stored?.features?.[1]?.weight === 1, { v: stored?.features?.[1]?.weight });
  check('features carry no _id noise', stored?.features?.[0]?._id === undefined);
  check('percent defaults to 25 when unset', stored?.preOrderDiscountPercent === 25, { v: stored?.preOrderDiscountPercent });

  // Clearing the date in the admin form posts '' — that must not 400 the edit.
  const cleared: any = await Book.findByIdAndUpdate(landing._id, { expectedReleaseDate: '' }, { new: true });
  check('clearing expectedReleaseDate does not throw', cleared?.expectedReleaseDate == null, { v: cleared?.expectedReleaseDate });

  console.log('\n── stock: the whole point ─────────────────────');

  const preOrdered: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
  });
  check('a pre-order book with stock 0 CAN be ordered', Boolean(preOrdered?._id));
  check('the order is flagged isPreOrder', preOrdered.isPreOrder === true, { v: preOrdered.isPreOrder });

  const soldOut = await rejects(
    () => place({ items: [{ bookSlugOrId: 'soldout-physio', quantity: 1 }], shippingAddress: addr(), paymentMethod: 'cod' }),
    'Insufficient stock'
  );
  check('a normal book with stock 0 still CANNOT', soldOut.threw && soldOut.matched === true, soldOut.message);

  // A book row written before this feature has no isPreOrder key at all.
  await Book.collection.insertOne({ id: 6, title: 'Legacy Sold Out', slug: 'legacy-soldout', price: 300, format: 'printed', stock: 0 });
  const legacyBook = await rejects(
    () => place({ items: [{ bookSlugOrId: 'legacy-soldout', quantity: 1 }], shippingAddress: addr(), paymentMethod: 'cod' }),
    'Insufficient stock'
  );
  check('a book predating the field is not treated as a pre-order', legacyBook.threw && legacyBook.matched === true, legacyBook.message);

  console.log('\n── the discount ───────────────────────────────');

  // 1000tk at the default 25%, inside Dhaka (60tk).
  check('25% off 1000tk → discount 250', preOrdered.discount === 250, { v: preOrdered.discount });
  check('subtotal is the undiscounted 1000', preOrdered.subtotal === 1000, { v: preOrdered.subtotal });
  check('total = 750 + delivery', preOrdered.total === 750 + preOrdered.deliveryCharge, {
    total: preOrdered.total,
    delivery: preOrdered.deliveryCharge,
  });
  check('total is 810 inside Dhaka', preOrdered.total === 810, { v: preOrdered.total });

  const custom: any = await place({
    items: [{ bookSlugOrId: 'pre-pharma', quantity: 1 }],
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
  });
  check('a custom preOrderDiscountPercent is honoured (40% → 400)', custom.discount === 400, { v: custom.discount });
  check('custom-percent total = 600 + 60', custom.total === 660, { v: custom.total });

  const qty: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 3 }],
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
  });
  check('discount scales with quantity (3 × 1000 → 750)', qty.discount === 750, { v: qty.discount });

  const mixed: any = await place({
    items: [
      { bookSlugOrId: 'pre-anatomy', quantity: 1 }, // 1000, pre-order
      { bookSlugOrId: 'stocked-biochem', quantity: 1 }, // 400, ordinary
    ],
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
  });
  check('mixed cart subtotal is 1400', mixed.subtotal === 1400, { v: mixed.subtotal });
  check('mixed cart discounts ONLY the pre-order line (250, not 350)', mixed.discount === 250, { v: mixed.discount });
  check('mixed cart total = 1400 - 250 + 60', mixed.total === 1210, { v: mixed.total });
  check('one pre-order line makes the whole order a pre-order', mixed.isPreOrder === true);

  const noPre: any = await place({
    items: [{ bookSlugOrId: 'stocked-biochem', quantity: 1 }],
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
  });
  check('an ordinary cart is not a pre-order', noPre.isPreOrder === false, { v: noPre.isPreOrder });
  check('an ordinary cart gets no discount', noPre.discount === 0, { v: noPre.discount });

  console.log('\n── the client cannot price its own order ──────');

  const forged: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
    // Everything a hostile client would send to pay 1tk. validateRequest does
    // not strip unknown keys, so these really do arrive at the service.
    discount: 999,
    subtotal: 1,
    total: 1,
    deliveryCharge: 0,
  });
  check('a client-sent discount is ignored', forged.discount === 250, { v: forged.discount });
  check('a client-sent subtotal is ignored', forged.subtotal === 1000, { v: forged.subtotal });
  check('a client-sent total is ignored', forged.total === 810, { v: forged.total });
  check('a client-sent deliveryCharge is ignored', forged.deliveryCharge === 60, { v: forged.deliveryCharge });

  // And the same body does not even get past validation as a "valid" shape that
  // some future refactor might spread wholesale.
  const orderZod = createOrderValidationSchema.safeParse({
    body: { items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }], shippingAddress: addr({ district: 'ঢাকা', division: 'ঢাকা' }) },
    params: {},
    query: {},
  });
  check('district + division validate on the order body', orderZod.success, (orderZod as any).error?.issues?.[0]);

  console.log('\n── courier zone from district ─────────────────');

  check("district 'ঢাকা' → inside-dhaka charge", preOrdered.deliveryCharge === 60, { v: preOrdered.deliveryCharge });
  check("district 'ঢাকা' → area inside-dhaka", preOrdered.shippingAddress?.area === 'inside-dhaka', { v: preOrdered.shippingAddress?.area });
  check('district persisted alongside area', preOrdered.shippingAddress?.district === 'ঢাকা', { v: preOrdered.shippingAddress?.district });

  const ctg: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ district: 'চট্টগ্রাম', division: 'চট্টগ্রাম' }),
    paymentMethod: 'cod',
  });
  check('another district → outside-dhaka charge', ctg.deliveryCharge === 130, { v: ctg.deliveryCharge });
  check('another district → area outside-dhaka', ctg.shippingAddress?.area === 'outside-dhaka', { v: ctg.shippingAddress?.area });
  check('division persisted', ctg.shippingAddress?.division === 'চট্টগ্রাম', { v: ctg.shippingAddress?.division });

  // Deriving must never make the order cheaper than the server agreed to.
  const liar: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ district: 'চট্টগ্রাম', area: 'inside-dhaka' }),
    paymentMethod: 'cod',
  });
  check('a far district beats a client-claimed inside-dhaka area', liar.deliveryCharge === 130, { v: liar.deliveryCharge });

  const spaced: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ district: '  ঢাকা  ' }),
    paymentMethod: 'cod',
  });
  check('surrounding whitespace does not change the zone', spaced.deliveryCharge === 60, { v: spaced.deliveryCharge });

  const romanised: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ district: 'Dhaka' }),
    paymentMethod: 'cod',
  });
  check('an unrecognised spelling falls to the DEARER zone', romanised.deliveryCharge === 130, { v: romanised.deliveryCharge });

  console.log('\n── no district ────────────────────────────────');

  const bare: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr(),
    paymentMethod: 'cod',
  });
  check('no district defaults to the dearer zone', bare.deliveryCharge === 130, { v: bare.deliveryCharge });
  check('no district → area outside-dhaka', bare.shippingAddress?.area === 'outside-dhaka', { v: bare.shippingAddress?.area });

  // The pre-district behaviour, unchanged: an explicit area is still honoured.
  const explicitArea: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ area: 'inside-dhaka' }),
    paymentMethod: 'cod',
  });
  check('an explicit area still works when no district is sent', explicitArea.deliveryCharge === 60, { v: explicitArea.deliveryCharge });

  console.log('\n── order of operations ────────────────────────');

  // Delivery is quoted on subtotal MINUS discount. With free delivery above 800,
  // a 1000tk pre-order discounted to 750 must still pay for shipping — quoting on
  // the raw 1000 would ship it free and lose the courier fee on every pre-order.
  await Settings.updateOne({}, { freeDeliveryAbove: 800 });
  const nearlyFree: any = await place({
    items: [{ bookSlugOrId: 'pre-anatomy', quantity: 1 }],
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
  });
  check('delivery is quoted on subtotal - discount, not subtotal', nearlyFree.deliveryCharge === 60, { v: nearlyFree.deliveryCharge });
  check('…and the total reflects it', nearlyFree.total === 810, { v: nearlyFree.total });

  const overThreshold: any = await place({
    items: [{ bookSlugOrId: 'stocked-biochem', quantity: 3 }], // 1200, no discount
    shippingAddress: addr({ district: 'ঢাকা' }),
    paymentMethod: 'cod',
  });
  check('free-delivery threshold still applies when it should', overThreshold.deliveryCharge === 0, { v: overThreshold.deliveryCharge });
  await Settings.updateOne({}, { freeDeliveryAbove: 0 });

  console.log('\n── orders placed before this change ───────────');

  // Written straight through the driver so Mongoose applies no defaults — this
  // is genuinely a document from before the feature shipped.
  const legacyId = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({
    _id: legacyId,
    orderNumber: 'ORD-LEGACY-0001',
    user: new mongoose.Types.ObjectId(),
    items: [{ book: new mongoose.Types.ObjectId(), title: 'Old Book', price: 500, quantity: 2, format: 'printed' }],
    deliveryType: 'printed',
    shippingAddress: { name: 'Old Buyer', phone: '01800000000', address: 'Old Rd', city: 'Khulna', area: 'outside-dhaka' },
    subtotal: 1000,
    discount: 0,
    deliveryCharge: 120,
    total: 1120,
    payment: { status: 'paid', method: 'manual' },
    status: 'delivered',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  } as any);

  const legacy: any = await Order.findById(legacyId);
  check('a pre-change order still loads', Boolean(legacy), { found: Boolean(legacy) });
  check('its total is untouched', legacy?.total === 1120, { v: legacy?.total });
  check('its subtotal is untouched', legacy?.subtotal === 1000, { v: legacy?.subtotal });
  check('its discount is still 0', legacy?.discount === 0, { v: legacy?.discount });
  check('it does not read back as a pre-order', legacy?.isPreOrder !== true, { v: legacy?.isPreOrder });
  check('its courier zone is intact', legacy?.shippingAddress?.area === 'outside-dhaka', { v: legacy?.shippingAddress?.area });
  check('its address survives having no district', legacy?.shippingAddress?.city === 'Khulna', { v: legacy?.shippingAddress?.city });

  // Re-saving an untouched legacy row must not invent money.
  legacy.adminNote = 'touched by admin';
  await legacy.save();
  const resaved: any = await Order.findById(legacyId).lean();
  check('re-saving a legacy order leaves the total alone', resaved?.total === 1120, { v: resaved?.total });
  check('re-saving a legacy order leaves the discount alone', resaved?.discount === 0, { v: resaved?.discount });

  // createOrder fires order alerts without awaiting them; let them land before
  // the connection goes away, or they log a confusing failure after the results.
  await new Promise((r) => setTimeout(r, 300));

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
