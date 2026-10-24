/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Recorded courses (25 Oct 2026):
 *   • the Super Admin creates the demo course with one call (and only one);
 *   • the lesson list is public, but videos only for staff, an enrolled
 *     student, or a free preview lesson;
 *   • "free" enrolment is refused for a paid course;
 *   • a manual (Send Money) order is priced by the server and waits for an
 *     admin; approving it opens the videos;
 *   • a draft course is hidden from the public; progress is the student's own.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { approveDevice } from './_approveDevice';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); } else { failed++; console.log(`  ❌ ${msg}`, detail ?? ''); }
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.SMS_API_KEY = '';
  process.env.SMS_USERNAME = '';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { User } = await import('../app/modules/user/user.model');
  const { Course } = await import('../app/modules/courses/course.model');
  const api = () => request(app);

  const make = async (email: string, role: string) => {
    await api().post('/api/auth/register').send({ firstName: role, lastName: 'T', email, password: 'pass1234', whatsappNumber: '01712345678' });
    await User.updateOne({ email }, { role, status: 'active' });
    if (role !== 'student') await approveDevice(email, `d-${email}`);
    const r = await api().post('/api/auth/login').set('x-device-id', `d-${email}`).send({ email, password: 'pass1234' });
    const u: any = await User.findOne({ email }).lean();
    return { h: { Authorization: `Bearer ${r.body?.data?.accessToken}` }, id: String(u._id) };
  };
  const S = await make('owner@t.com', 'superAdmin');
  const A = await make('admin@t.com', 'admin');
  const st = await make('student@t.com', 'student');
  const st2 = await make('student2@t.com', 'student');

  console.log('── Demo course ──');
  const d1 = await api().post('/api/courses/demo-course').set(S.h);
  check(d1.status === 201 && d1.body?.data?.type === 'Recorded' && d1.body?.data?.status === 'published', 'Super Admin creates the demo course', d1.body);
  const d2 = await api().post('/api/courses/demo-course').set(S.h);
  check(d2.status === 200 && String(d2.body?.data?._id) === String(d1.body?.data?._id), 'running it again returns the same course');
  check((await api().post('/api/courses/demo-course').set(A.h)).status === 403, 'an admin cannot');
  const courseId = String(d1.body.data._id);

  console.log('── Lessons ──');
  const pub = await api().get(`/api/lessons/course/${courseId}`);
  const lessons = pub.body?.data || [];
  check(lessons.length === 7, 'the public sees all 7 lesson titles', lessons.length);
  const free = lessons.find((l: any) => l.isFree);
  check(!!free?.videoUrl && free.locked === false, 'the free preview has its video');
  check(lessons.filter((l: any) => !l.isFree).every((l: any) => !l.videoUrl && l.locked === true), 'the rest are locked, no video');
  const asStudent = (await api().get(`/api/lessons/course/${courseId}`).set(st.h)).body?.data || [];
  check(asStudent.filter((l: any) => l.videoUrl).length === 1, 'a student who has not bought it: still only the preview');
  const asAdmin = (await api().get(`/api/lessons/course/${courseId}`).set(A.h)).body?.data || [];
  check(asAdmin.every((l: any) => l.videoUrl), 'staff see every video');
  const one = await api().get(`/api/lessons/${lessons.find((l: any) => !l.isFree)._id}`);
  check(one.body?.data?.locked === true && !one.body?.data?.videoUrl, 'a single locked lesson has no video either');

  console.log('── Buying ──');
  check((await api().post('/api/payment/free/enroll').set(st.h).send({ courseId })).status === 400, '"free" enrolment refused for a paid course');
  check((await api().post('/api/enrollments/enroll').set(st.h).send({ courseId, payment: { method: 'free', amount: 0 } })).status === 400, 'and through the other route too');
  const man = await api().post('/api/payment/manual/submit').set(st.h).send({ courseId, amount: 1, totalFee: 1, transactionId: 'TRX123', senderNumber: '01711000000', paymentType: 'bkash' });
  check(man.status === 200 && man.body?.data?.payment?.amount === 499 && man.body?.data?.status === 'pending', 'Send Money order: server price ৳499, pending', man.body?.data?.payment);
  const acc1 = await api().get(`/api/enrollments/check-access/${courseId}`).set(st.h);
  check(acc1.body?.data?.hasAccess === false && acc1.body?.data?.pending === true, 'no access while pending (and it says pending)');
  check((await api().get('/api/courses').query({ status: 'draft' })).body?.data?.every?.((c: any) => c.status === 'published'), 'the public cannot list drafts with ?status=');
  const all = await api().get('/api/enrollments/all').set(A.h).query({ status: 'pending' });
  const pending = (all.body?.data?.enrollments || all.body?.data || []).find?.((e: any) => String(e.courseId?._id || e.courseId) === courseId);
  check(!!pending, 'the order is on the admin list', all.body);
  const ap = await api().patch(`/api/enrollments/approve/${pending?._id}`).set(A.h);
  check(ap.status === 200, 'admin approves', ap.body);
  const acc2 = await api().get(`/api/enrollments/check-access/${courseId}`).set(st.h);
  check(acc2.body?.data?.hasAccess === true, 'access after approval');
  const after = (await api().get(`/api/lessons/course/${courseId}`).set(st.h)).body?.data || [];
  check(after.every((l: any) => l.videoUrl), 'every video opens for the enrolled student');
  check((await api().get(`/api/enrollments/check-access/${courseId}`).set(A.h)).body?.data?.hasAccess === true, 'staff can open any course (Course View)');

  console.log('── Free course, drafts, progress ──');
  await Course.updateOne({ _id: courseId }, { $set: { fee: '0', offerPrice: '0' } });
  const fr = await api().post('/api/payment/free/enroll').set(st2.h).send({ courseId });
  check(fr.status === 200 && fr.body?.data?.status === 'active', 'a free course enrols at once');
  await Course.updateOne({ _id: courseId }, { $set: { status: 'draft' } });
  check((await api().get(`/api/courses/${courseId}`)).status === 404, 'a draft course is hidden from the public');
  check((await api().get(`/api/courses/${courseId}`).set(A.h)).status === 200, 'but staff can open it');
  check((await api().get(`/api/lessons/progress/${courseId}/${st.id}`).set(st2.h)).status === 400, "a student cannot read another's progress");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
