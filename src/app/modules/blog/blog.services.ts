import { isValidObjectId } from 'mongoose';
import { Blog } from './blog.model';
import { IBlog } from './blog.interface';

// CREATE - Create new blog
const createBlogService = async (payload: IBlog): Promise<IBlog> => {
    const newBlog = await Blog.create(payload);
    return newBlog;
};

// READ - Get all blogs
const getAllBlogsService = async (): Promise<IBlog[]> => {
    const blogs = await Blog.find({}).sort({ createdAt: -1 });
    return blogs;
};

// READ - Get single blog by ID (guard invalid ObjectId → 404, not a 500 CastError)
const getSingleBlogService = async (id: string): Promise<IBlog | null> => {
    if (!isValidObjectId(id)) return null;
    const blog = await Blog.findById(id);
    return blog;
};

// UPDATE - Update blog by ID
const updateBlogService = async (
    id: string,
    payload: Partial<IBlog>
): Promise<IBlog | null> => {
    const updatedBlog = await Blog.findByIdAndUpdate(id, payload, { new: true });
    return updatedBlog;
};

// DELETE - Delete blog by ID
const deleteBlogService = async (id: string): Promise<IBlog | null> => {
    const deletedBlog = await Blog.findByIdAndDelete(id);
    return deletedBlog;
};

// Get featured blogs
const getFeaturedBlogsService = async (): Promise<IBlog[]> => {
    const blogs = await Blog.find({ featured: true, status: 'published' })
        .sort({ createdAt: -1 })
        .limit(5);
    return blogs;
};

// Get blogs by category
const getBlogsByCategoryService = async (category: string): Promise<IBlog[]> => {
    const blogs = await Blog.find({ category, status: 'published' })
        .sort({ createdAt: -1 });
    return blogs;
};

export const BlogService = {
    createBlogService,
    getAllBlogsService,
    getSingleBlogService,
    updateBlogService,
    deleteBlogService,
    getFeaturedBlogsService,
    getBlogsByCategoryService,
};
