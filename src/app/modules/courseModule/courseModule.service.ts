import { CourseModule } from './courseModule.model';
import { ICourseModule } from './courseModule.interface';

const createModule = async (payload: ICourseModule) => {
  // Auto-set order if not provided
  if (!payload.order) {
    const lastModule = await CourseModule.findOne({ courseId: payload.courseId, isDeleted: false })
      .sort({ order: -1 });
    payload.order = lastModule ? lastModule.order + 1 : 1;
  }
  const result = await CourseModule.create(payload);
  return result;
};

const getModulesByCourse = async (courseId: string) => {
  const modules = await CourseModule.find({ courseId, isDeleted: false })
    .sort({ order: 1 });
  return modules;
};

const getSingleModule = async (id: string) => {
  const result = await CourseModule.findById(id);
  if (!result || result.isDeleted) throw new Error('Module not found');
  return result;
};

const updateModule = async (id: string, payload: Partial<ICourseModule>) => {
  const result = await CourseModule.findByIdAndUpdate(id, payload, { new: true });
  if (!result) throw new Error('Module not found');
  return result;
};

const deleteModule = async (id: string) => {
  const result = await CourseModule.findByIdAndUpdate(id, { isDeleted: true }, { new: true });
  if (!result) throw new Error('Module not found');
  return result;
};

const reorderModules = async (courseId: string, moduleOrders: { moduleId: string; order: number }[]) => {
  const bulkOps = moduleOrders.map(({ moduleId, order }) => ({
    updateOne: {
      filter: { _id: moduleId as any, courseId: courseId as any },
      update: { $set: { order } },
    },
  }));
  await CourseModule.bulkWrite(bulkOps as any);
  const modules = await CourseModule.find({ courseId, isDeleted: false }).sort({ order: 1 });
  return modules;
};

export const CourseModuleService = {
  createModule,
  getModulesByCourse,
  getSingleModule,
  updateModule,
  deleteModule,
  reorderModules,
};
