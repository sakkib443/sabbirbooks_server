/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { BlogService } from './blog.services';

// CREATE Blog
const createBlogController = async (req: Request, res: Response) => {
    try {
        const blog = await BlogService.createBlogService(req.body);
        res.status(201).json({
            success: true,
            message: 'Blog created successfully',
            data: blog,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET All Blogs
const getAllBlogsController = async (req: Request, res: Response) => {
    try {
        const blogs = await BlogService.getAllBlogsService();
        res.status(200).json({ success: true, data: blogs });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET Single Blog
const getSingleBlogController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const blog = await BlogService.getSingleBlogService(id);
        if (!blog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.status(200).json({ success: true, data: blog });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// UPDATE Blog
const updateBlogController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updatedBlog = await BlogService.updateBlogService(id, req.body);
        if (!updatedBlog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Blog updated successfully',
            data: updatedBlog,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE Blog
const deleteBlogController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const deletedBlog = await BlogService.deleteBlogService(id);
        if (!deletedBlog) {
            return res.status(404).json({ success: false, message: 'Blog not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Blog deleted successfully',
            data: deletedBlog,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET Featured Blogs
const getFeaturedBlogsController = async (req: Request, res: Response) => {
    try {
        const blogs = await BlogService.getFeaturedBlogsService();
        res.status(200).json({ success: true, data: blogs });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET Blogs by Category
const getBlogsByCategoryController = async (req: Request, res: Response) => {
    try {
        const { category } = req.params;
        const blogs = await BlogService.getBlogsByCategoryService(category);
        res.status(200).json({ success: true, data: blogs });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const BlogController = {
    createBlogController,
    getAllBlogsController,
    getSingleBlogController,
    updateBlogController,
    deleteBlogController,
    getFeaturedBlogsController,
    getBlogsByCategoryController,
};
