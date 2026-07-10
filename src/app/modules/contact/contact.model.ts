import { Schema, model } from 'mongoose';
import { IContact } from './contact.interface';

const contactSchema = new Schema<IContact>(
    {
        name: { type: String, required: true },
        email: { type: String, required: true },
        subject: { type: String, required: true },
        message: { type: String, required: true },
        status: {
            type: String,
            enum: ['unread', 'read', 'replied'],
            default: 'unread'
        },
    },
    { timestamps: true }
);

export const Contact = model<IContact>('Contact', contactSchema);
