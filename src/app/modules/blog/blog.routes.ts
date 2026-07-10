import express from 'express';
import { BlogController } from './blog.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

const adminOnly = [authMiddleware, authorize('admin', 'superAdmin', 'trainingManager')];

// Create blog (admin) — also accept POST '/' as an alias
router.post('/create', ...adminOnly, BlogController.createBlogController);
router.post('/', ...adminOnly, BlogController.createBlogController);

// Get all blogs
router.get('/', BlogController.getAllBlogsController);

// Get featured blogs
router.get('/featured', BlogController.getFeaturedBlogsController);

// Get blogs by category
router.get('/category/:category', BlogController.getBlogsByCategoryController);

// Get single blog by ID
router.get('/:id', BlogController.getSingleBlogController);

// Update blog by ID (admin) — accept PATCH and PUT
router.patch('/:id', ...adminOnly, BlogController.updateBlogController);
router.put('/:id', ...adminOnly, BlogController.updateBlogController);

// Delete blog by ID (admin)
router.delete('/:id', ...adminOnly, BlogController.deleteBlogController);

export const BlogRoutes = router;
