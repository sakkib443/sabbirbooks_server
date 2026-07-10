import express from 'express';
import { SiteContentController } from './siteContent.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

const adminOnly = [authMiddleware, authorize('admin', 'superAdmin', 'trainingManager')];

// Admin: list pages that have content
router.get('/', ...adminOnly, SiteContentController.listPages);
// Admin: save a page's content
router.put('/:page', ...adminOnly, SiteContentController.savePageContent);
// Public: read a page's content (website renders from this)
router.get('/:page', SiteContentController.getPageContent);

export const SiteContentRoutes = router;
