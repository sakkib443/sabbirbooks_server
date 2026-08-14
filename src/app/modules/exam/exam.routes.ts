import express from 'express';
import { ExamController } from './exam.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Exams are course delivery → `training.manage`. See assignment.routes.ts.

// Student routes (BEFORE /:id)
router.get('/my-results', authMiddleware, ExamController.myResults);
router.get('/marks-sheet/:courseId', authMiddleware, ExamController.marksSheet);

// Exam CRUD (Admin/Mentor)
router.post('/', authMiddleware, authorize('admin', 'mentor', 'trainingManager'), requireCapability('training.manage'), ExamController.createExam);
router.get('/', authMiddleware, ExamController.getAllExams);
router.get('/:id', authMiddleware, ExamController.getExam);
router.patch('/:id', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), ExamController.updateExam);
router.delete('/:id', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), ExamController.deleteExam);

// Questions
router.post('/:examId/questions', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), ExamController.addQuestion);
router.get('/:examId/questions', authMiddleware, ExamController.getQuestions);
router.patch('/questions/:questionId', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), ExamController.updateQuestion);
router.delete('/questions/:questionId', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), ExamController.deleteQuestion);

// Exam taking
router.post('/:examId/start', authMiddleware, ExamController.startExam);
router.post('/submissions/:submissionId/submit', authMiddleware, ExamController.submitExam);
router.get('/submissions/:submissionId', authMiddleware, ExamController.getSubmission);

// Grading
router.get('/:examId/submissions', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), ExamController.getSubmissions);
router.patch('/submissions/:submissionId/grade', authMiddleware, authorize('admin', 'mentor'), requireCapability('training.manage'), ExamController.gradeAnswer);

export const ExamRoutes = router;
