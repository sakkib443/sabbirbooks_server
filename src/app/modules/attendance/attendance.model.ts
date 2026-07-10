import { Schema, model, Document } from 'mongoose';

export interface IAttendanceRecord {
  studentId: Schema.Types.ObjectId;
  status: 'present' | 'absent' | 'late' | 'excused';
  note?: string;
}

export interface IAttendance extends Document {
  batchId: Schema.Types.ObjectId;
  mentorId: Schema.Types.ObjectId;
  date: Date;
  classTitle?: string;
  records: IAttendanceRecord[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    mentorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    classTitle: { type: String },
    records: [
      {
        studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        status: {
          type: String,
          enum: ['present', 'absent', 'late', 'excused'],
          default: 'absent',
        },
        note: { type: String },
      },
    ],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One attendance per batch per date
attendanceSchema.index({ batchId: 1, date: 1 }, { unique: true });

export const Attendance = model<IAttendance>('Attendance', attendanceSchema);
