import { Schema, model, Types } from 'mongoose';

export interface INotification {
  userId: Types.ObjectId;
  type: 'payment' | 'enrollment' | 'class' | 'exam' | 'assignment' | 'certificate' | 'system' | 'reminder';
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  isDeleted: boolean;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['payment', 'enrollment', 'class', 'exam', 'assignment', 'certificate', 'system', 'reminder'],
      default: 'system',
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String },
    isRead: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);
