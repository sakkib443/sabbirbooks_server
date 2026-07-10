import { Schema, model } from 'mongoose';
import { ICategory } from './courseCategory.interface';


// Mongoose Schema: ডাটাবেজে Category কিভাবে সংরক্ষণ হবে তা নির্ধারণ করেeeeeeeeeee
const categorySchema = new Schema<ICategory>(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },

  },
  {
    timestamps: true, // createdAt এবং updatedAt ফিল্ড অটোমেটিক যোগ করবে
  }
);

export const Category = model<ICategory>('Category', categorySchema);
