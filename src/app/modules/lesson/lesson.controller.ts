import { Request, Response } from 'express';
import { LessonService } from './lesson.service';

const createLesson = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.createLesson(req.body);
    res.status(201).json({ success: true, message: 'Lesson created successfully', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLessonsByModule = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.getLessonsByModule(req.params.moduleId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getLessonsByCourse = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.getLessonsByCourse(req.params.courseId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getSingleLesson = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.getSingleLesson(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const updateLesson = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.updateLesson(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Lesson updated', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteLesson = async (req: Request, res: Response) => {
  try {
    await LessonService.deleteLesson(req.params.id);
    res.status(200).json({ success: true, message: 'Lesson deleted' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const addMaterial = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    const material = {
      title: req.body.title || file?.originalname || 'Untitled',
      fileUrl: file?.path || req.body.fileUrl,
      fileType: req.body.fileType || file?.mimetype || 'unknown',
      fileSize: file?.size,
    };
    const result = await LessonService.addMaterial(req.params.id, material);
    res.status(200).json({ success: true, message: 'Material added', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const removeMaterial = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.removeMaterial(req.params.id, req.params.materialId);
    res.status(200).json({ success: true, message: 'Material removed', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Student Progress ────────────────────────────────────────

const updateProgress = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.updateProgress({
      lessonId: req.params.id,
      studentId: req.body.studentId,
      courseId: req.body.courseId,
      watchedPercent: req.body.watchedPercent,
      lastPosition: req.body.lastPosition,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getStudentProgress = async (req: Request, res: Response) => {
  try {
    const result = await LessonService.getStudentProgress(req.params.courseId, req.params.studentId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const LessonController = {
  createLesson,
  getLessonsByModule,
  getLessonsByCourse,
  getSingleLesson,
  updateLesson,
  deleteLesson,
  addMaterial,
  removeMaterial,
  updateProgress,
  getStudentProgress,
};
