/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { ExamService } from './exam.service';

// ═══ EXAM CRUD ══════════════════════════════════════════════
const createExam = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await ExamService.createExam({ ...req.body, createdBy: user._id });
    res.status(201).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getAllExams = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.getAllExams(req.query as any);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getExam = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.getExam(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const updateExam = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.updateExam(req.params.id, req.body);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const deleteExam = async (req: Request, res: Response) => {
  try {
    await ExamService.deleteExam(req.params.id);
    res.status(200).json({ success: true, message: 'Deleted' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ═══ QUESTIONS ══════════════════════════════════════════════
const addQuestion = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.addQuestion({ ...req.body, examId: req.params.examId });
    res.status(201).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getQuestions = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const includeAnswers = ['admin', 'mentor', 'trainingManager'].includes(user.role);
    const result = await ExamService.getQuestions(req.params.examId, includeAnswers);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const updateQuestion = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.updateQuestion(req.params.questionId, req.body);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const deleteQuestion = async (req: Request, res: Response) => {
  try {
    await ExamService.deleteQuestion(req.params.questionId);
    res.status(200).json({ success: true, message: 'Deleted' });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ═══ EXAM TAKING ════════════════════════════════════════════
const startExam = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await ExamService.startExam(req.params.examId, user._id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const submitExam = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.submitExam(req.params.submissionId, req.body.answers);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ═══ GRADING ════════════════════════════════════════════════
const getSubmissions = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.getSubmissions(req.params.examId);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const gradeAnswer = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { marks, feedback, answerId } = req.body;
    const result = await ExamService.gradeWrittenAnswer(req.params.submissionId, answerId, marks, feedback, user._id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getSubmission = async (req: Request, res: Response) => {
  try {
    const result = await ExamService.getSubmission(req.params.submissionId);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

// ═══ STUDENT ════════════════════════════════════════════════
const myResults = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await ExamService.getStudentResults(user._id);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const marksSheet = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await ExamService.getMarksSheet(user._id, req.params.courseId);
    res.status(200).json({ success: true, data: result });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

export const ExamController = {
  createExam, getAllExams, getExam, updateExam, deleteExam,
  addQuestion, getQuestions, updateQuestion, deleteQuestion,
  startExam, submitExam,
  getSubmissions, gradeAnswer, getSubmission,
  myResults, marksSheet,
};
