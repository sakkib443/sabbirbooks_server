import { Types } from 'mongoose';
import { BookAccess, BookTopicScan } from './bookAccess.model';
import { Order } from '../order/order.model';
import { BookCopy } from '../bookCopy/bookCopy.model';

/**
 * The single gate for every piece of book content.
 *
 * A GRANT, and nothing else. There are two ways to hold one:
 *   • the reader redeemed the code printed inside their copy (bookCopy.service)
 *   • an admin gave it to them by hand — a gift copy, a replacement for a
 *     damaged book, or a customer who bought before codes existed
 *
 * WHY A DELIVERED ORDER IS NOT ENOUGH ANY MORE
 *
 * It used to be: your order reached 'delivered', you could read the book. That
 * is wrong for the way this shop actually sells. One student orders six copies
 * on one account so the delivery charge is paid once, then hands five to
 * classmates — and the account that placed the order could read all six books
 * while five people holding a paid-for copy could read none. A student buying a
 * copy as a gift had the same problem in reverse: the access landed on the
 * giver.
 *
 * The book in someone's hands is what was paid for, so the book carries the
 * proof: a code under a scratch panel, redeemed once, onto whichever account is
 * holding it. Six copies, six codes, six readers.
 *
 * The cost of this is real and worth stating: somebody whose parcel arrived and
 * who has not typed their code in gets nothing. That is why the locked screen
 * says "got the book? enter the code inside it" rather than "you don't own this
 * book" — see the reader-facing pages.
 *
 * DIGITAL COPIES
 *
 * A digital-only order has no printed copy and therefore no code, so paying for
 * one grants access directly. That branch is kept below. It is dormant today —
 * the shop sells printed books — but a digital sale must not be sold access it
 * then cannot be given.
 */
const hasBookAccess = async (
  userId: string | Types.ObjectId,
  bookId: string | Types.ObjectId
): Promise<boolean> => {
  const grant = await BookAccess.findOne({ userId, bookId, revokedAt: { $exists: false } }).lean();
  if (grant) return true;

  const digital = await Order.findOne({
    user: userId,
    'items.book': bookId,
    // A refunded order keeps payment.status 'paid' (updateOrderStatus only
    // downgrades an UNpaid payment to 'failed'), so without this the branch
    // below would keep serving content after the money went back.
    status: { $ne: 'cancelled' },
    'payment.status': 'paid',
    items: { $elemMatch: { book: bookId, format: 'digital' } },
  })
    .select('_id')
    .lean();

  return Boolean(digital);
};

/**
 * True when the user has bought this book but it has not reached them yet.
 *
 * Only meaningful once hasBookAccess has already said no. Without this the
 * reader is told "you don't own this book — buy it", which for a customer
 * whose parcel is in transit reads as an invitation to pay twice.
 */
const hasPendingDelivery = async (
  userId: string | Types.ObjectId,
  bookId: string | Types.ObjectId
): Promise<boolean> => {
  const order = await Order.findOne({
    user: userId,
    'items.book': bookId,
    status: { $nin: ['cancelled', 'delivered', 'access-granted'] },
    items: { $elemMatch: { book: bookId, format: 'printed' } },
  })
    .select('_id')
    .lean();

  return Boolean(order);
};

/**
 * Note that this user has opened this topic.
 *
 * Scanning the printed code is what unlocks a topic; once unlocked it stays
 * reachable, so a reader who scanned on the bus can finish the answer at home.
 * The physical book is still the gate for the FIRST view of every topic.
 */
const recordScan = async (
  userId: string | Types.ObjectId,
  bookId: string | Types.ObjectId,
  topicId: string | Types.ObjectId
): Promise<void> => {
  await BookTopicScan.findOneAndUpdate(
    { userId, topicId },
    {
      $setOnInsert: { userId, bookId, topicId, firstScannedAt: new Date() },
      $set: { lastScannedAt: new Date() },
      $inc: { scanCount: 1 },
    },
    { upsert: true }
  );
};

/** Topics this user has scanned, newest first — powers the dashboard history. */
const getScanHistory = async (userId: string | Types.ObjectId, limit = 50) => {
  return BookTopicScan.find({ userId })
    .sort({ lastScannedAt: -1 })
    .limit(limit)
    .populate({ path: 'topicId', select: 'title titleBn topicNo qrCode chapterId isImplicit' })
    .populate({ path: 'bookId', select: 'title slug coverImage' })
    .lean();
};

const grantAccess = async (payload: {
  userId: string;
  bookId: string;
  grantedBy?: string;
  note?: string;
}) => {
  return BookAccess.findOneAndUpdate(
    { userId: payload.userId, bookId: payload.bookId },
    {
      $set: {
        source: 'manual',
        grantedBy: payload.grantedBy,
        note: payload.note,
      },
      $unset: { revokedAt: '' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const revokeAccess = async (userId: string, bookId: string) => {
  return BookAccess.findOneAndUpdate(
    { userId, bookId },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
};

const listAccess = async (bookId: string) => {
  return BookAccess.find({ bookId })
    .populate({ path: 'userId', select: 'name email phone' })
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Everyone who can read a book, and how each of them came by it.
 *
 * The shop's question is not "who has access" — that is a list of emails and
 * tells them nothing. It is "does this hold together": did the person who
 * redeemed this code also buy a book, or did they get one from a friend, or is
 * somebody working through codes they should not have?
 *
 * So each row carries the three things that answer it:
 *
 *   how       redeemed a code · given by an admin · paid for a digital copy
 *   code      which copy, from which print run
 *   order     an order on the SAME account, if there is one
 *
 * The order match is the interesting column. A row with a code and no order is
 * completely normal — it is the classmate who was handed a book, which is the
 * whole reason this system exists. A row with an order and no code is somebody
 * who has their parcel and has not typed the code in yet. Neither is wrong;
 * both are worth being able to see.
 */
const accessReport = async (query: {
  book?: string;
  how?: string;
  q?: string;
  page?: string;
  limit?: string;
}) => {
  const filter: Record<string, unknown> = {};
  if (query.book && Types.ObjectId.isValid(query.book)) filter.bookId = query.book;

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);

  const all = await BookAccess.find(filter)
    .populate({ path: 'userId', select: 'firstName lastName name email phoneNumber whatsappNumber status role medicalCollegeName createdAt' })
    .populate({ path: 'bookId', select: 'title slug' })
    .populate({ path: 'grantedBy', select: 'firstName lastName email' })
    .sort({ createdAt: -1 })
    .lean();

  const userIds = all.map((a: any) => a.userId?._id).filter(Boolean);
  const bookIds = [...new Set(all.map((a: any) => String(a.bookId?._id)).filter(Boolean))];

  // The two things each row is cross-referenced against, fetched once rather
  // than per row — this list is read whole, not paged, on the server.
  const [copies, orders] = await Promise.all([
    BookCopy.find({ redeemedBy: { $in: userIds } })
      .select('code batch book redeemedBy redeemedAt holder')
      .lean(),
    Order.find({
      user: { $in: userIds },
      'items.book': { $in: bookIds },
      status: { $ne: 'cancelled' },
    })
      .select('orderNumber user items.book items.quantity status createdAt deliveredAt total')
      .lean(),
  ]);

  const codeByUser = new Map<string, any>();
  for (const c of copies) codeByUser.set(`${c.redeemedBy}|${c.book}`, c);

  const ordersByUser = new Map<string, any[]>();
  for (const o of orders as any[]) {
    for (const it of o.items || []) {
      const key = `${o.user}|${it.book}`;
      if (!ordersByUser.has(key)) ordersByUser.set(key, []);
      ordersByUser.get(key)!.push({ ...o, quantity: it.quantity });
    }
  }

  let rows = all.map((a: any) => {
    const key = `${a.userId?._id}|${a.bookId?._id}`;
    const copy = codeByUser.get(key);
    const theirOrders = ordersByUser.get(key) || [];

    // How they came by it, in the order the shop would say it.
    const how = copy ? 'code' : a.source === 'order' ? 'digital' : 'manual';

    return {
      _id: a._id,
      user: a.userId,
      book: a.bookId,
      how,
      active: !a.revokedAt,
      revokedAt: a.revokedAt || null,
      grantedAt: a.createdAt,
      grantedBy: a.grantedBy || null,
      note: a.note || '',
      code: copy
        ? { code: copy.code, batch: copy.batch, redeemedAt: copy.redeemedAt, holder: copy.holder }
        : null,
      // Does it line up with a purchase on the same account?
      orders: theirOrders.map((o: any) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        quantity: o.quantity,
        total: o.total,
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt || null,
      })),
      matchesOrder: theirOrders.length > 0,
    };
  });

  if (query.how && query.how !== 'all') {
    if (query.how === 'matched') rows = rows.filter((r) => r.matchesOrder);
    else if (query.how === 'unmatched') rows = rows.filter((r) => !r.matchesOrder);
    else if (query.how === 'blocked') rows = rows.filter((r) => !r.active);
    else rows = rows.filter((r) => r.how === query.how);
  }

  if (query.q) {
    const t = String(query.q).trim().toLowerCase();
    rows = rows.filter((r: any) =>
      [
        r.user?.email,
        r.user?.firstName,
        r.user?.lastName,
        r.user?.phoneNumber,
        r.code?.code,
        r.code?.holder?.fullName,
        r.code?.holder?.classRoll,
        ...r.orders.map((o: any) => o.orderNumber),
      ]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(t))
    );
  }

  const counts = {
    all: rows.length,
    code: rows.filter((r) => r.how === 'code').length,
    manual: rows.filter((r) => r.how === 'manual').length,
    matched: rows.filter((r) => r.matchesOrder).length,
    unmatched: rows.filter((r) => !r.matchesOrder).length,
    blocked: rows.filter((r) => !r.active).length,
  };

  return {
    rows: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
    counts,
  };
};

/**
 * Buyers whose parcel arrived and who have not opened the book.
 *
 * The gap this system deliberately creates: delivery no longer grants access,
 * so somebody can be holding a paid-for book and reading nothing. Most of them
 * simply have not noticed the code. The shop needs to be able to see them, and
 * to hand access over when somebody rings up about it.
 */
const waitingForCode = async (bookId?: string) => {
  const match: Record<string, unknown> = {
    status: { $in: ['delivered', 'access-granted'] },
    'items.format': 'printed',
  };
  if (bookId && Types.ObjectId.isValid(bookId)) match['items.book'] = new Types.ObjectId(bookId);

  const delivered = await Order.find(match)
    .select('orderNumber user items.book items.title items.quantity deliveredAt createdAt total shippingAddress.name shippingAddress.phone')
    .populate({ path: 'user', select: 'firstName lastName email phoneNumber' })
    .sort({ deliveredAt: -1 })
    .lean();

  const withAccess = new Set(
    (
      await BookAccess.find({ revokedAt: { $exists: false } }).select('userId bookId').lean()
    ).map((a: any) => `${a.userId}|${a.bookId}`)
  );

  return delivered
    .filter((o: any) =>
      (o.items || []).some((i: any) => i.book && !withAccess.has(`${o.user?._id}|${i.book}`))
    )
    .map((o: any) => ({
      orderNumber: o.orderNumber,
      user: o.user,
      buyerName: o.shippingAddress?.name || '',
      buyerPhone: o.shippingAddress?.phone || '',
      items: o.items,
      total: o.total,
      deliveredAt: o.deliveredAt || null,
      createdAt: o.createdAt,
    }));
};

export const BookAccessService = {
  hasBookAccess,
  hasPendingDelivery,
  recordScan,
  getScanHistory,
  grantAccess,
  revokeAccess,
  listAccess,
  accessReport,
  waitingForCode,
};
