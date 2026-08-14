import express from 'express';
import { BlogController } from './blog.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Blogs are content: the content-only manager is added, and every writer now
// needs the `content.write` capability an admin can revoke.
const adminOnly = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager', 'contentManager'),
  requireCapability('content.write'),
];

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
