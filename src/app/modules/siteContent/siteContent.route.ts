import express from 'express';
import { SiteContentController } from './siteContent.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Website page copy is content — see book.routes.ts for the pattern.
const adminOnly = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager', 'contentManager', 'manager'),
  requireCapability('content.write'),
];

// Admin: list pages that have content
router.get('/', ...adminOnly, SiteContentController.listPages);
// Admin: save a page's content
router.put('/:page', ...adminOnly, SiteContentController.savePageContent);
// Public: read a page's content (website renders from this)
router.get('/:page', SiteContentController.getPageContent);

export const SiteContentRoutes = router;
