import { Schema, model } from 'mongoose';
import { IBlog } from './blog.interface';

const blogSchema = new Schema<IBlog>(
    {
        title: { type: String, required: true },
        titleBn: { type: String, required: false },
        excerpt: { type: String, required: false },
        excerptBn: { type: String, required: false },
        content: { type: String, required: true },
        contentBn: { type: String, required: false },
        category: { type: String, required: true },
        author: { type: String, required: true, default: 'Admin' },
        image: { type: String, required: true },
        tags: [{ type: String }],
        status: {
            type: String,
            enum: ['published', 'draft'],
            default: 'published'
        },
        featured: { type: Boolean, default: false },
    },
    { timestamps: true }
);

export const Blog = model<IBlog>('Blog', blogSchema);
