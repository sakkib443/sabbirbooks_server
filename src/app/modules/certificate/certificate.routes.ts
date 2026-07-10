import express from 'express';
import { CertificateController } from './certificate.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// Public: Verify certificate (NO auth needed)
router.get('/verify/:certId', CertificateController.verify);
router.get('/search', CertificateController.search);

// Student: My certificates
router.get('/my', authMiddleware, CertificateController.myCertificates);

// Batch-based certification (Admin + Training Manager)
router.get('/batches', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.getCertBatches);
router.get('/batch-students/:batchId', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.getBatchStudents);
router.post('/toggle-eligibility', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.toggleEligibility);
router.post('/bulk-grant', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.bulkGrant);

// Admin
router.post('/', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.create);
router.get('/', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.getAll);
router.get('/pending', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.getPending);
router.get('/stats', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.stats);
router.get('/:certId', authMiddleware, CertificateController.getById);
router.patch('/:certId', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.update);
router.patch('/:certId/activate', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.activate);
router.patch('/:certId/revoke', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.revoke);
router.delete('/:certId', authMiddleware, authorize('admin', 'trainingManager'), CertificateController.remove);

export const CertificateRoutes = router;
