import { ICategory } from "./courseCategory.interface";
import { Category } from "./courseCategory.model";
import { Course } from "../courses/course.model";


// CREATE → নতুন category তৈরি করে (id অটো সিরিয়ালি: শেষ id + 1)
const createCategoryServices = async (
  payload: Pick<ICategory, 'name'>
): Promise<ICategory> => {
  const lastCategory = await Category.findOne().sort({ id: -1 });
  const nextId = lastCategory ? lastCategory.id + 1 : 1;
  const newCategory = await Category.create({ id: nextId, name: payload.name });
  return newCategory;
};

// READ → সব category নিয়ে আসে - ID অনুযায়ী ascending order
const getAllCategoriesServices = async (): Promise<ICategory[]> => {
  const categories = await Category.find({}).sort({ _id: 1 });
  return categories;
};

// READ → একক category আইডি দিয়ে নিয়ে আসে
const getSingleCategoryServices = async (id: number): Promise<ICategory | null> => {
  const category = await Category.findOne({ id });
  return category;
};

// DELETE → মঙ্গোডিবি _id দিয়ে ডিলিট
const deleteCategoryServices = async (id: string): Promise<ICategory | null> => {
  // Block delete if any course still references this category (required ref → would orphan).
  const inUse = await Course.countDocuments({ category: id });
  if (inUse > 0) {
    throw new Error(`Cannot delete: ${inUse} course${inUse > 1 ? 's' : ''} still use this category. Reassign or remove those courses first.`);
  }
  return await Category.findByIdAndDelete(id);
};

// UPDATE → মঙ্গোডিবি _id দিয়ে আপডেট
const updateCategoryServices = async (
  id: string,
  payload: Partial<ICategory>
): Promise<ICategory | null> => {
  // শুধু name আপডেট হয় — id সিকোয়েন্স অপরিবর্তিত থাকে
  return await Category.findByIdAndUpdate(id, { name: payload.name }, { new: true });
};

export const CategoryService = {
  createCategoryServices,
  getAllCategoriesServices,
  getSingleCategoryServices,
  updateCategoryServices,
  deleteCategoryServices,
};
