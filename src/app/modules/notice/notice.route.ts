import { Router } from 'express';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { uploadFileLocal } from '../../config/localUpload';
import * as C from './notice.controller';

const router = Router();

// ── Public (footer notice-board page) ──
router.get('/public', C.getPublic);

// ── Student board (audience filtered by active enrollment) ──
router.get('/my', authMiddleware, C.getForStudent);

// ── Admin / Training Manager ──
router.post('/upload', authMiddleware, authorize('admin', 'trainingManager'), uploadFileLocal.single('file'), C.uploadAttachment);
router.get('/', authMiddleware, authorize('admin', 'trainingManager'), C.getAll);
router.post('/', authMiddleware, authorize('admin', 'trainingManager'), C.create);
router.patch('/:id', authMiddleware, authorize('admin', 'trainingManager'), C.update);
router.delete('/:id', authMiddleware, authorize('admin', 'trainingManager'), C.remove);

export const NoticeRoutes = router;
