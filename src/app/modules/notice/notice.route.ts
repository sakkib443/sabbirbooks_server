import { Router } from 'express';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { uploadFileLocal } from '../../config/localUpload';
import * as C from './notice.controller';

const router = Router();

// Notices are published content — see book.routes.ts for the pattern.
const contentWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager', 'contentManager', 'manager'),
  requireCapability('content.write'),
];
// Deleting additionally needs records.delete, which the add-and-edit
// `manager` role deliberately does not have.
const contentWriteDelete = [...contentWrite, requireCapability('records.delete')];

// ── Public (footer notice-board page) ──
router.get('/public', C.getPublic);

// ── Student board (audience filtered by active enrollment) ──
router.get('/my', authMiddleware, C.getForStudent);

// ── Admin / Training Manager ──
router.post('/upload', ...contentWrite, uploadFileLocal.single('file'), C.uploadAttachment);
router.get('/', ...contentWrite, C.getAll);
router.post('/', ...contentWrite, C.create);
router.patch('/:id', ...contentWrite, C.update);
router.delete('/:id', ...contentWriteDelete, C.remove);

export const NoticeRoutes = router;
