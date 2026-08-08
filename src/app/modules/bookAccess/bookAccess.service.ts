import { Types } from 'mongoose';
import { BookAccess, BookTopicScan } from './bookAccess.model';
import { Order } from '../order/order.model';

// Order states that mean the buyer has paid for the book. A printed book ships
// after payment, so waiting for 'delivered' would leave a paying reader locked
// out for the days the parcel is in transit — and the QR is scanned from the
// book they are already holding. Manual (Send Money) orders only reach 'paid'
// after an admin verifies the transaction, so this is not self-service.
const PAID_ORDER_STATUSES = ['paid', 'processing', 'shipped', 'delivered', 'access-granted'];

/**
 * The single gate for every piece of book content.
 *
 * True when either an explicit grant exists, or the user has an order for this
 * book whose payment is confirmed.
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
    $or: [{ 'payment.status': 'paid' }, { status: { $in: PAID_ORDER_STATUSES } }],
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
  recordScan,
  getScanHistory,
  grantAccess,
  revokeAccess,
  listAccess,
};
