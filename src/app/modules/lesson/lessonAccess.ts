/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Who may watch a course's lessons (25 Oct 2026, when recorded courses went
 * public again).
 *
 * The lesson list is public — a buyer should see what a course contains before
 * paying — but the video and the lesson's text are only for:
 *   • staff (they build and check the course),
 *   • a student with an ACTIVE enrollment in that course,
 *   • anyone, for a lesson marked free (the preview).
 * Everyone else gets the titles and lengths with the content taken out.
 * Lessons and modules still marked draft are hidden from non-staff entirely.
 */
import { Enrollment } from '../enrollment/enrollment.model';

export const STAFF_ROLES = ['superAdmin', 'admin', 'manager', 'contentManager', 'trainingManager', 'mentor'];

export const isStaff = (user: any) => STAFF_ROLES.includes(String(user?.role || ''));

/** May this (possibly anonymous) user watch every lesson of the course? */
export const canWatchCourse = async (user: any, courseId: unknown): Promise<boolean> => {
  if (!user) return false;
  if (isStaff(user)) return true;
  if (!courseId) return false;
  const found = await Enrollment.exists({
    studentId: user._id,
    courseId,
    status: 'active',
    isDeleted: false,
  });
  return !!found;
};

const CONTENT_FIELDS = ['videoUrl', 'videoPublicId', 'textContent', 'materials'];

/** The lesson as this viewer may see it. */
export const shapeLesson = (lesson: any, canWatch: boolean) => {
  const plain = typeof lesson?.toObject === 'function' ? lesson.toObject() : { ...lesson };
  if (canWatch || plain.isFree) return { ...plain, locked: false };
  for (const f of CONTENT_FIELDS) delete plain[f];
  return { ...plain, locked: true };
};

/** A list of lessons for this viewer: drafts out for non-staff, content locked where it should be. */
export const shapeLessons = (lessons: any[], user: any, canWatch: boolean) =>
  (lessons || [])
    .filter((l) => isStaff(user) || l?.isPublished !== false)
    .map((l) => shapeLesson(l, canWatch));
