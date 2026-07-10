import { Schema, model, Types } from 'mongoose';

export interface IInstallment {
  enrollmentId: Types.ObjectId;
  studentId: Types.ObjectId;
  courseId: Types.ObjectId;
  installmentNumber: number;
  amount: number;
  dueDate: Date;
  paidDate?: Date;
  status: 'upcoming' | 'due' | 'paid' | 'overdue';
  transactionId?: string;
  method?: string;
  notes?: string;
  isDeleted: boolean;
}

const installmentSchema = new Schema<IInstallment>(
  {
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    installmentNumber: { type: Number, required: true },
    amount: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, required: true },
    paidDate: { type: Date },
    status: {
      type: String,
      enum: ['upcoming', 'due', 'paid', 'overdue'],
      default: 'upcoming',
    },
    transactionId: { type: String },
    method: { type: String },
    notes: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

installmentSchema.index({ enrollmentId: 1 });
installmentSchema.index({ studentId: 1, status: 1 });
installmentSchema.index({ dueDate: 1, status: 1 });

export const Installment = model<IInstallment>('Installment', installmentSchema);
