/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A ready-made demo recorded course (25 Oct 2026) — so the shop can see the
 * whole flow (list → details → checkout → player) before uploading its own.
 * The Super Admin creates it with one button on All Courses; running it again
 * returns the same course instead of making a second.
 *
 * Written in both languages: `title` / `details` / `text` are English, the
 * `…Bn` fields Bengali — the site picks by the language switch.
 *
 * Paid, with no free class (the shop, 25 Oct 2026): every class opens only
 * after the order is approved.
 *
 * The videos are public sample videos on YouTube; replace them with the
 * shop's own unlisted lesson videos from the course editor.
 */
import { Course } from './course.model';
import { CourseService } from './course.services';
import { CourseModuleService } from '../courseModule/courseModule.service';
import { LessonService } from '../lesson/lesson.service';
import { Lesson } from '../lesson/lesson.model';

export const DEMO_COURSE_SLUG = 'demo-anatomy-viva-recorded';

// videoDuration is in seconds, as the lesson editor and the player read it.
const SAMPLE = {
  a: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  b: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
};

const MODULES = [
  {
    title: 'Before you start',
    titleBn: 'শুরু করার আগে',
    lessons: [
      { title: 'How this course works', titleBn: 'কোর্সটা কীভাবে সাজানো', videoUrl: SAMPLE.a, videoDuration: 300 },
      { title: 'What the viva board asks', titleBn: 'ভাইভা বোর্ডে কী জিজ্ঞেস করে', videoUrl: SAMPLE.b, videoDuration: 600 },
    ],
  },
  {
    title: 'Upper Limb — viva preparation',
    titleBn: 'Upper Limb — ভাইভা প্রস্তুতি',
    lessons: [
      { title: 'Brachial plexus — the questions that always come', titleBn: 'Brachial plexus — যে প্রশ্নগুলো আসবেই', videoUrl: SAMPLE.a, videoDuration: 720 },
      { title: 'Shoulder joint — card-by-card revision', titleBn: 'Shoulder joint — কার্ড ধরে ধরে রিভিশন', videoUrl: SAMPLE.b, videoDuration: 900 },
      { title: 'Practical: Bones of the upper limb', titleBn: 'প্র্যাকটিক্যাল: Upper limb-এর হাড়', videoUrl: SAMPLE.a, videoDuration: 540 },
    ],
  },
  {
    title: 'Thorax — viva preparation',
    titleBn: 'Thorax — ভাইভা প্রস্তুতি',
    lessons: [
      { title: 'Heart — surface marking and questions', titleBn: 'Heart — surface marking ও প্রশ্ন', videoUrl: SAMPLE.b, videoDuration: 840 },
      { title: 'Lungs and pleura — quick revision', titleBn: 'Lungs ও pleura — দ্রুত রিভিশন', videoUrl: SAMPLE.a, videoDuration: 660 },
    ],
  },
];

/**
 * The demo first went in with its first class free to watch; the shop wants
 * every class paid. Takes the free mark (and the "free preview" words) off the
 * demo's classes. Safe to run again.
 */
export const makeDemoCoursePaidOnly = async (): Promise<number> => {
  const course: any = await Course.findOne({ slug: DEMO_COURSE_SLUG }).select('_id').lean();
  if (!course) return 0;
  const r = await Lesson.updateMany({ courseId: course._id, isFree: true }, { $set: { isFree: false } });
  await Lesson.updateMany(
    { courseId: course._id, title: 'How this course works (free preview)' },
    { $set: { title: 'How this course works', titleBn: 'কোর্সটা কীভাবে সাজানো' } }
  );
  return r.modifiedCount;
};

export const createDemoCourse = async () => {
  const existing: any = await Course.findOne({ slug: DEMO_COURSE_SLUG }).lean();
  if (existing) return { course: existing, created: false };

  const lessonCount = MODULES.reduce((n, m) => n + m.lessons.length, 0);
  const course: any = await CourseService.createCourseServices({
    title: 'Demo: Anatomy Viva — Recorded Course',
    titleBn: 'ডেমো: অ্যানাটমি ভাইভা — রেকর্ডেড কোর্স',
    slug: DEMO_COURSE_SLUG,
    type: 'Recorded',
    status: 'published',
    fee: '999',
    offerPrice: '499',
    lectures: lessonCount,
    details:
      'Recorded classes for the 1st Prof anatomy viva — watch any time, as often as you like. This is a demo course: the videos are samples, the real classes come later.',
    detailsBn:
      '১ম প্রফের অ্যানাটমি ভাইভার জন্য রেকর্ড করা ক্লাস — যেকোনো সময়, যতবার খুশি দেখুন। এটি একটি ডেমো কোর্স: ভিডিওগুলো নমুনা, আসল ক্লাস পরে বসানো হবে।',
    courseIncludes: [
      { icon: 'video', text: `${lessonCount} recorded classes`, textBn: `${lessonCount}টি রেকর্ড করা ক্লাস` },
      { icon: 'clock', text: 'Watch any time', textBn: 'যেকোনো সময় দেখা যায়' },
      { icon: 'device', text: 'On mobile and computer', textBn: 'মোবাইল ও কম্পিউটারে' },
    ],
  } as any);

  for (const m of MODULES) {
    const mod: any = await CourseModuleService.createModule({ courseId: course._id, title: m.title, titleBn: m.titleBn, isPublished: true } as any);
    for (const l of m.lessons) {
      await LessonService.createLesson({
        moduleId: mod._id,
        title: l.title,
        titleBn: l.titleBn,
        type: 'video',
        videoUrl: l.videoUrl,
        videoDuration: l.videoDuration,
        isFree: false,
        isPublished: true,
      } as any);
    }
  }
  return { course, created: true };
};
