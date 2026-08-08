import { Schema, model, Types } from 'mongoose';

// Explicit grant, for the cases an order cannot express: gift copies, replacing
// a damaged book, review copies, bulk institutional handouts.
export interface IBookAccess {
  userId: Types.ObjectId;
  bookId: Types.ObjectId;
  source: 'order' | 'manual';
  orderId?: Types.ObjectId;
  grantedBy?: Types.ObjectId;
  note?: string;
  revokedAt?: Date;
}

const bookAccessSchema = new Schema<IBookAccess>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    source: { type: String, enum: ['order', 'manual'], default: 'manual' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true },
    // Soft revoke — keeps the audit trail of who was granted what.
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

bookAccessSchema.index({ userId: 1, bookId: 1 }, { unique: true });

// Which topics a reader has unlocked by scanning. Recorded so a topic stays
// reachable after the first scan (see bookAccess.service.recordScan).
export interface IBookTopicScan {
  userId: Types.ObjectId;
  bookId: Types.ObjectId;
  topicId: Types.ObjectId;
  scanCount: number;
  firstScannedAt: Date;
  lastScannedAt: Date;
}

const bookTopicScanSchema = new Schema<IBookTopicScan>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'BookTopic', required: true },
    scanCount: { type: Number, default: 1 },
    firstScannedAt: { type: Date, default: Date.now },
    lastScannedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

bookTopicScanSchema.index({ userId: 1, topicId: 1 }, { unique: true });
bookTopicScanSchema.index({ userId: 1, lastScannedAt: -1 });

export const BookAccess = model<IBookAccess>('BookAccess', bookAccessSchema);
export const BookTopicScan = model<IBookTopicScan>('BookTopicScan', bookTopicScanSchema);
