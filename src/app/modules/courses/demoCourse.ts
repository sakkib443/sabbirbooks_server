/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A ready-made demo recorded course (25 Oct 2026) — so the shop can see the
 * whole flow (list → details → checkout → player) before uploading its own.
 * The Super Admin creates it with one button on All Courses; running it again
 * returns the same course instead of making a second.
 *
 * The videos are public sample videos on YouTube; replace them with the
 * shop's own unlisted lesson videos from the course editor.
 */
import { Course } from './course.model';
import { CourseService } from './course.services';
import { CourseModuleService } from '../courseModule/courseModule.service';
import { LessonService } from '../lesson/lesson.service';

export const DEMO_COURSE_SLUG = 'demo-anatomy-viva-recorded';

// videoDuration is in seconds, as the lesson editor and the player read it.
const SAMPLE = {
  a: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
  b: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
};

const MODULES = [
  {
    title: 'শুরু করার আগে',
    lessons: [
      { title: 'কোর্সটা কীভাবে সাজানো (ফ্রি প্রিভিউ)', videoUrl: SAMPLE.a, videoDuration: 300, isFree: true },
      { title: 'ভাইভা বোর্ডে কী জিজ্ঞেস করে', videoUrl: SAMPLE.b, videoDuration: 600 },
    ],
  },
  {
    title: 'Upper Limb — ভাইভা প্রস্তুতি',
    lessons: [
      { title: 'Brachial plexus — যে প্রশ্নগুলো আসবেই', videoUrl: SAMPLE.a, videoDuration: 720 },
      { title: 'Shoulder joint — card-by-card রিভিশন', videoUrl: SAMPLE.b, videoDuration: 900 },
      { title: 'Practical: Bones of upper limb', videoUrl: SAMPLE.a, videoDuration: 540 },
    ],
  },
  {
    title: 'Thorax — ভাইভা প্রস্তুতি',
    lessons: [
      { title: 'Heart — surface marking ও প্রশ্ন', videoUrl: SAMPLE.b, videoDuration: 840 },
      { title: 'Lungs ও pleura — দ্রুত রিভিশন', videoUrl: SAMPLE.a, videoDuration: 660 },
    ],
  },
];

export const createDemoCourse = async () => {
  const existing: any = await Course.findOne({ slug: DEMO_COURSE_SLUG }).lean();
  if (existing) return { course: existing, created: false };

  const lessonCount = MODULES.reduce((n, m) => n + m.lessons.length, 0);
  const course: any = await CourseService.createCourseServices({
    title: 'ডেমো: অ্যানাটমি ভাইভা — রেকর্ডেড কোর্স',
    slug: DEMO_COURSE_SLUG,
    type: 'Recorded',
    status: 'published',
    fee: '999',
    offerPrice: '499',
    lectures: lessonCount,
    details:
      '১ম প্রফের অ্যানাটমি ভাইভার জন্য রেকর্ড করা ক্লাস — যেকোনো সময়, যতবার খুশি দেখুন। এটি একটি ডেমো কোর্স: ভিডিওগুলো নমুনা, আসল ক্লাস পরে বসানো হবে।',
    courseIncludes: [
      { icon: 'video', text: `${lessonCount}টি রেকর্ড করা ভিডিও` },
      { icon: 'clock', text: 'যেকোনো সময় দেখা যায়' },
      { icon: 'device', text: 'মোবাইল ও কম্পিউটারে' },
    ],
  } as any);

  for (const m of MODULES) {
    const mod: any = await CourseModuleService.createModule({ courseId: course._id, title: m.title, isPublished: true } as any);
    for (const l of m.lessons) {
      await LessonService.createLesson({
        moduleId: mod._id,
        title: l.title,
        type: 'video',
        videoUrl: l.videoUrl,
        videoDuration: l.videoDuration,
        isFree: !!(l as any).isFree,
        isPublished: true,
      } as any);
    }
  }
  return { course, created: true };
};
