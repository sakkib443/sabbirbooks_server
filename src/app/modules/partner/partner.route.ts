import { Router } from 'express';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { uploadFileLocal } from '../../config/localUpload';
import * as C from './partner.controller';

const router = Router();

// Partner logos on the homepage are content — see book.routes.ts for the pattern.
const contentWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'contentManager', 'manager'),
  requireCapability('content.write'),
];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.
const contentWriteDelete = [...contentWrite, requireCapability('records.delete')];

// ── Public (homepage carousel) ──
router.get('/public', C.getPublic);

// ── Admin / Managers with content.write ──
router.post('/upload', ...contentWrite, uploadFileLocal.single('logo'), C.uploadLogo);
router.get('/', ...contentWrite, C.getAll);
router.post('/', ...contentWrite, C.create);
router.patch('/:id', ...contentWrite, C.update);
router.delete('/:id', ...contentWriteDelete, C.remove);

export const PartnerRoutes = router;
