import { Lesson, LessonProgress } from './lesson.model';
import { ILesson, ILessonProgress } from './lesson.interface';
import { CourseModule } from '../courseModule/courseModule.model';

// ─── Lesson CRUD ─────────────────────────────────────────────

const createLesson = async (payload: ILesson) => {
  // Verify module exists
  const moduleDoc = await CourseModule.findById(payload.moduleId);
  if (!moduleDoc || moduleDoc.isDeleted) throw new Error('Module not found');

  // Auto-set courseId from module
  payload.courseId = moduleDoc.courseId;

  // Auto-set order
  if (!payload.order) {
    const lastLesson = await Lesson.findOne({ moduleId: payload.moduleId, isDeleted: false })
      .sort({ order: -1 });
    payload.order = lastLesson ? lastLesson.order + 1 : 1;
  }

  const result = await Lesson.create(payload);
  return result;
};

const getLessonsByModule = async (moduleId: string) => {
  const lessons = await Lesson.find({ moduleId, isDeleted: false })
    .sort({ order: 1 });
  return lessons;
};

const getLessonsByCourse = async (courseId: string) => {
  const lessons = await Lesson.find({ courseId, isDeleted: false })
    .sort({ order: 1 })
    .populate('moduleId', 'title order');
  return lessons;
};

const getSingleLesson = async (id: string) => {
  const result = await Lesson.findById(id).populate('moduleId', 'title courseId');
  if (!result || result.isDeleted) throw new Error('Lesson not found');
  return result;
};

const updateLesson = async (id: string, payload: Partial<ILesson>) => {
  const result = await Lesson.findByIdAndUpdate(id, payload, { new: true });
  if (!result) throw new Error('Lesson not found');
  return result;
};

const deleteLesson = async (id: string) => {
  const result = await Lesson.findByIdAndUpdate(id, { isDeleted: true }, { new: true });
  if (!result) throw new Error('Lesson not found');
  return result;
};

const addMaterial = async (lessonId: string, material: { title: string; fileUrl: string; fileType: string; fileSize?: number }) => {
  const result = await Lesson.findByIdAndUpdate(
    lessonId,
    { $push: { materials: material } },
    { new: true }
  );
  if (!result) throw new Error('Lesson not found');
  return result;
};

const removeMaterial = async (lessonId: string, materialId: string) => {
  const result = await Lesson.findByIdAndUpdate(
    lessonId,
    { $pull: { materials: { _id: materialId } } },
    { new: true }
  );
  if (!result) throw new Error('Lesson not found');
  return result;
};

// ─── Lesson Progress (Student) ───────────────────────────────

const updateProgress = async (payload: {
  lessonId: string;
  studentId: string;
  courseId: string;
  watchedPercent: number;
  lastPosition?: number;
}) => {
  const isCompleted = payload.watchedPercent >= 90;

  const result = await LessonProgress.findOneAndUpdate(
    { lessonId: payload.lessonId, studentId: payload.studentId },
    {
      courseId: payload.courseId,
      watchedPercent: payload.watchedPercent,
      lastPosition: payload.lastPosition || 0,
      lastWatchedAt: new Date(),
      ...(isCompleted ? { isCompleted: true, completedAt: new Date() } : {}),
    },
    { upsert: true, new: true }
  );
  return result;
};

const getStudentProgress = async (courseId: string, studentId: string) => {
  const progress = await LessonProgress.find({ courseId, studentId });
  const totalLessons = await Lesson.countDocuments({ courseId, isDeleted: false, isPublished: true });
  const completedLessons = progress.filter((p) => p.isCompleted).length;
  const overallPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return {
    progress,
    totalLessons,
    completedLessons,
    overallPercent,
    isCompleted: overallPercent === 100,
  };
};

const getLessonProgress = async (lessonId: string, studentId: string) => {
  const progress = await LessonProgress.findOne({ lessonId, studentId });
  return progress;
};

export const LessonService = {
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
  getLessonProgress,
};
