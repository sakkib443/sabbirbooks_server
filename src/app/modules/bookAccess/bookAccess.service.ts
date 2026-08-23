import { Types } from 'mongoose';
import { BookAccess, BookTopicScan } from './bookAccess.model';
import { Order } from '../order/order.model';

// Order states that unlock a PRINTED book's QR content. Waiting for
// 'delivered' is deliberate: the QR is scanned from the paper page, and
// handing out access at 'paid' would let a buyer read the whole book before
// the parcel even ships. If the buyer needs early access (out-of-stock hold,
// courier delay, complaint) an admin can grant it manually via the access
// endpoints — that path is preserved. Digital items have nothing to deliver
// and are handled below.
const PRINTED_ACCESS_STATUSES = ['delivered', 'access-granted'];

/**
 * The single gate for every piece of book content.
 *
 * True when any one of the following holds:
 *   • an explicit BookAccess grant (manual, gift, etc.)
 *   • an order whose PRINTED copy of this book has reached the delivered
 *     rung of the ladder
 *   • an order that contains a DIGITAL copy of this book and has been paid —
 *     digital has no shipping step, so waiting for 'delivered' would lock the
 *     buyer out forever
 */
const hasBookAccess = async (
  userId: string | Types.ObjectId,
  bookId: string | Types.ObjectId
): Promise<boolean> => {
  const grant = await BookAccess.findOne({ userId, bookId, revokedAt: { $exists: false } }).lean();
  if (grant) return true;

  const order = await Order.findOne({
    user: userId,
    'items.book': bookId,
    // A refunded order keeps payment.status 'paid' (updateOrderStatus only
    // downgrades an UNpaid payment to 'failed'), so without this the digital
    // branch below would keep serving content after the money went back.
    status: { $ne: 'cancelled' },
    $or: [
      // Printed copy that has actually reached the buyer.
      {
        status: { $in: PRINTED_ACCESS_STATUSES },
        items: { $elemMatch: { book: bookId, format: 'printed' } },
      },
      // Digital copy — payment is the only fulfillment step there is.
      {
        'payment.status': 'paid',
        items: { $elemMatch: { book: bookId, format: 'digital' } },
      },
    ],
  })
    .select('_id')
    .lean();

  return Boolean(order);
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

export const BookAccessService = {
  hasBookAccess,
  hasPendingDelivery,
  recordScan,
  getScanHistory,
  grantAccess,
  revokeAccess,
  listAccess,
};
