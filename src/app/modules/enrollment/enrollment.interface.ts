import { Types } from 'mongoose';

export type TPaymentMethod = 'bkash' | 'sslcommerz' | 'manual' | 'free' | 'cash';
export type TPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type TEnrollmentStatus = 'pending' | 'active' | 'expired' | 'cancelled' | 'completed' | 'deleted';

export interface IPayment {
  amount: number;
  method: TPaymentMethod;
  transactionId?: string;
  status: TPaymentStatus;
  paidAt?: Date;
  gatewayData?: Record<string, any>;
}

export interface IEnrollment {
  studentId: Types.ObjectId;
  courseId: Types.ObjectId;
  batchId?: Types.ObjectId;
  status: TEnrollmentStatus;
  enrolledAt: Date;
  expiresAt?: Date;
  payment: IPayment;
  customFee?: number;
  couponCode?: string;
  couponDiscount?: number;
  completionPercent: number;
  studentStatus?: 'active' | 'completed' | 'dropout' | 'inactive';
  completedAt?: Date;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
