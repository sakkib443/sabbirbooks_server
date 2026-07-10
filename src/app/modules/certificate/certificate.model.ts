import { Schema, model } from 'mongoose';
import { ICertificate } from './certificate.interface';

const certificateSchema = new Schema<ICertificate>(
    {
        id: { type: String, required: true, unique: true },
        studentId: { type: String, required: true },
        studentName: { type: String, required: true },
        batchId: { type: String, required: true },
        courseName: { type: String, required: true },
        batchNumber: { type: String, required: true },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        issueDate: { type: Date, default: Date.now },
        status: {
            type: String,
            enum: ['pending', 'active', 'revoked'],
            default: 'pending',
        },
        qrCode: { type: String },
        verificationUrl: { type: String },
        pdfUrl: { type: String },
        activatedBy: { type: String },
        activatedAt: { type: Date },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

certificateSchema.index({ studentId: 1 });
certificateSchema.index({ status: 1 });

export const Certificate = model<ICertificate>('Certificate', certificateSchema);
