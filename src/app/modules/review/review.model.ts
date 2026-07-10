import { Schema, model } from 'mongoose';
import { IReview } from './review.interface';

const reviewSchema = new Schema<IReview>(
    {
        name: { type: String, required: true, trim: true },
        role: { type: String, trim: true, default: '' },
        courseTag: { type: String, trim: true, default: '' },
        rating: { type: Number, required: true, min: 1, max: 5, default: 5 },
        text: { type: String, required: true, trim: true },
        // Stored as a base64 data URL (small avatar) or an external image URL. Optional.
        image: { type: String, default: '' },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'approved',
        },
    },
    { timestamps: true }
);

export const Review = model<IReview>('Review', reviewSchema);
