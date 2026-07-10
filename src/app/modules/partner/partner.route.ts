import { Router } from 'express';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { uploadFileLocal } from '../../config/localUpload';
import * as C from './partner.controller';

const router = Router();

// ── Public (homepage carousel) ──
router.get('/public', C.getPublic);

// ── Admin / Training Manager ──
router.post('/upload', authMiddleware, authorize('admin', 'trainingManager'), uploadFileLocal.single('logo'), C.uploadLogo);
router.get('/', authMiddleware, authorize('admin', 'trainingManager'), C.getAll);
router.post('/', authMiddleware, authorize('admin', 'trainingManager'), C.create);
router.patch('/:id', authMiddleware, authorize('admin', 'trainingManager'), C.update);
router.delete('/:id', authMiddleware, authorize('admin', 'trainingManager'), C.remove);

export const PartnerRoutes = router;
