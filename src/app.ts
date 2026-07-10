import cors, { CorsOptions } from 'cors';
import express, { Application, Request, Response } from 'express';
import path from 'path';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';

import globalErrorHandler from './app/middlewares/globalErrorHandler';

import { UserRoutes } from './app/modules/user/user.route';
import { AuthRoutes } from './app/modules/auth/auth.routes';
import { StudentRoutes } from './app/modules/student/student.route';
import { MentorRoutes } from './app/modules/mentor/mentor.routes';
import { CourseRoutes } from './app/modules/courses/course.routes';
import { CategoryRoutes } from './app/modules/courseCategory/courseCategory.routes';
import { ModuleRoutes } from './app/modules/courseModule/courseModule.routes';
import { LessonRoutes } from './app/modules/lesson/lesson.routes';
import { BookRoutes } from './app/modules/book/book.routes';
import { EnrollmentRoutes } from './app/modules/enrollment/enrollment.routes';
import { CourseCouponRoutes } from './app/modules/coupon/coupon.route';
import { InstallmentRoutes } from './app/modules/installment/installment.routes';
import { InvoiceRoutes } from './app/modules/invoice/invoice.routes';
import { PaymentRoutes } from './app/modules/payment/payment.routes';
import { AnalyticsRoutes } from './app/modules/analytics/analytics.routes';
import { SettingsRoutes } from './app/modules/settings/settings.routes';
import { ContactRoutes } from './app/modules/contact/contact.routes';
import { SiteContentRoutes } from './app/modules/siteContent/siteContent.route';
import { BatchRoutes } from './app/modules/batch/batch.routes';
import { ClassScheduleRoutes } from './app/modules/classSchedule/classSchedule.routes';
import { CertificateRoutes } from './app/modules/certificate/certificate.routes';
import { QrResourceRoutes } from './app/modules/qrResource/qrResource.routes';
import { OrderRoutes } from './app/modules/order/order.routes';
import { AttendanceRoutes } from './app/modules/attendance/attendance.routes';
import { ExamRoutes } from './app/modules/exam/exam.routes';
import { AssignmentRoutes } from './app/modules/assignment/assignment.routes';
import { NotificationRoutes } from './app/modules/notification/notification.routes';
import { ReviewRoutes } from './app/modules/review/review.routes';
import { BlogRoutes } from './app/modules/blog/blog.routes';
import { NoticeRoutes } from './app/modules/notice/notice.route';
import { PartnerRoutes } from './app/modules/partner/partner.route';

const app: Application = express();

// ✅ Security: Helmet (HTTP headers)
app.use(helmet());

// ✅ Security: CORS — reflects the request origin so localhost (dev) and the
// deployed client (Vercel) both work. Auth is Bearer-token (not cookies), so
// reflecting origins is low-risk; tighten to an allow-list later if desired.
const corsOptions: CorsOptions = {
  origin: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
};
app.use(cors(corsOptions));

// ✅ Parsers
app.use(express.json({ limit: '10mb' }));

// ✅ Security: NoSQL Injection Prevention
app.use(mongoSanitize());

// Health check
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'Sabbir Book Server is running 🚀' });
});

// ─── Application Routes ─────────────────────────────────────
app.use('/api/user', UserRoutes);
app.use('/api/auth', AuthRoutes);
app.use('/api/students', StudentRoutes);
app.use('/api/mentors', MentorRoutes);
app.use('/api/courses', CourseRoutes);
app.use('/api/categories', CategoryRoutes);
app.use('/api/modules', ModuleRoutes);
app.use('/api/lessons', LessonRoutes);
app.use('/api/books', BookRoutes);
app.use('/api/enrollments', EnrollmentRoutes);
app.use('/api/coupon', CourseCouponRoutes);
app.use('/api/installments', InstallmentRoutes);
app.use('/api/invoice', InvoiceRoutes);
app.use('/api/payment', PaymentRoutes);
app.use('/api/analytics', AnalyticsRoutes);
app.use('/api/settings', SettingsRoutes);
app.use('/api/contacts', ContactRoutes);
app.use('/api/site-content', SiteContentRoutes);
app.use('/api/batches', BatchRoutes);
app.use('/api/classes', ClassScheduleRoutes);
app.use('/api/certificate', CertificateRoutes);
app.use('/api/qr', QrResourceRoutes);
app.use('/api/orders', OrderRoutes);
app.use('/api/attendance', AttendanceRoutes);
app.use('/api/exams', ExamRoutes);
app.use('/api/assignments', AssignmentRoutes);
app.use('/api/notifications', NotificationRoutes);
app.use('/api/reviews', ReviewRoutes);
app.use('/api/blogs', BlogRoutes);
app.use('/api/notices', NoticeRoutes);
app.use('/api/partners', PartnerRoutes);

// Serve locally-uploaded files (class materials, certificates, etc.)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Global error handler
app.use(globalErrorHandler);

export default app;
