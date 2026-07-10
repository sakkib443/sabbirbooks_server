import { isValidObjectId } from 'mongoose';
import { Course } from './course.model';
import { ICourse } from './course.interface';



// CREATE → নতুন কোর্স তৈরি করার সার্ভিস
const createCourseServices = async (payload: ICourse): Promise<ICourse> => {


  // ৩. যদি mentor ও category উভয়টাই থাকে, তাহলে কোর্স তৈরি করা হবে
  const newCourse = await Course.create(payload);
  return newCourse;
};


// READ → সব কোর্স রিটার্ন (with search, filter, sort, pagination)
const getAllCoursesServices = async (query?: {
  search?: string;
  category?: string;
  type?: string;
  status?: string;
  sort?: string;
  page?: number;
  limit?: number;
  publicOnly?: boolean;
}): Promise<{ courses: ICourse[]; total: number; page: number; totalPages: number }> => {
  const filter: any = {};
  const {
    search, category, type, status,
    sort = 'newest', page = 1, limit = 50,
    publicOnly = false,
  } = query || {};

  // Combine status + search with $and so one $or doesn't overwrite the other
  // (previously search wiped the published-only filter → drafts leaked publicly).
  const and: any[] = [];

  // Status filter — public API shows only published (or courses without status field)
  if (publicOnly) {
    and.push({ $or: [{ status: 'published' }, { status: { $exists: false } }] });
  } else if (status && status !== 'all') {
    filter.status = status;
  }
  // status === 'all' → no filter, show everything

  // Category filter
  if (category) filter.category = category;

  // Type filter
  if (type) filter.type = type;

  // Search
  if (search) {
    and.push({
      $or: [
        { title: { $regex: search, $options: 'i' } },
        { technology: { $regex: search, $options: 'i' } },
      ],
    });
  }

  if (and.length) filter.$and = and;

  // Sort options
  let sortOption: any = { _id: -1 };
  switch (sort) {
    case 'newest': sortOption = { createdAt: -1 }; break;
    case 'oldest': sortOption = { createdAt: 1 }; break;
    case 'price_low': sortOption = { fee: 1 }; break;
    case 'price_high': sortOption = { fee: -1 }; break;
    case 'popular': sortOption = { totalStudentsEnroll: -1 }; break;
    case 'rating': sortOption = { rating: -1 }; break;
  }

  const total = await Course.countDocuments(filter);
  const courses = await Course.find(filter)
    .sort(sortOption)
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    courses,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
};


// Resolve a course by Mongo _id, numeric `id`, OR slug — the public site links
// by numeric id (/courses/4) while the admin edit form uses _id. Using findById
// alone 500'd (CastError) on a numeric id/slug; a single $or query fixes that.
const getSingleCourseServices = async (idOrSlug: string) => {
  const or: Record<string, unknown>[] = [{ slug: idOrSlug }];
  if (!isNaN(Number(idOrSlug))) or.push({ id: Number(idOrSlug) });
  if (isValidObjectId(idOrSlug)) or.push({ _id: idOrSlug });
  return await Course.findOne({ $or: or }).populate('mentor').populate('category');
};

const updateCourseServices = async (id: string, payload: any) => {
  return await Course.findByIdAndUpdate(id, payload, { new: true });
};

// DELETE → নির্দিষ্ট কোর্স ডিলিট করার সার্ভিস
// CourseService.ts
const deleteCourseServices = async (id: string): Promise<ICourse | null> => {
  // findOneAndDelete({id}) এর বদলে findByIdAndDelete ব্যবহার করুন
  const deletedCourse = await Course.findByIdAndDelete(id)
    .populate('mentor')
    .populate('category');
  return deletedCourse;
};


// সব সার্ভিস এক্সপোর্ট করা হচ্ছে
export const CourseService = {
  createCourseServices,
  getAllCoursesServices,
  getSingleCourseServices,
  updateCourseServices,
  deleteCourseServices,
};
