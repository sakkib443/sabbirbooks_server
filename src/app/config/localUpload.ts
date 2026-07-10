// Local disk storage for class materials / recordings / PDFs.
// Used because Cloudinary credentials are not configured — files are saved under
// <serverRoot>/uploads/materials and served statically at /uploads/materials/*.
// @ts-ignore
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Serverless filesystems (Vercel) are read-only except /tmp — write there so module
// load never crashes; locally use <serverRoot>/uploads. (Cloud storage still needed for
// uploads to actually persist/serve on serverless — see deploy notes.)
const UPLOAD_ROOT = process.env.VERCEL ? '/tmp' : process.cwd();
const MATERIALS_DIR = path.join(UPLOAD_ROOT, 'uploads', 'materials');
try {
  fs.mkdirSync(MATERIALS_DIR, { recursive: true });
} catch (err: any) {
  console.warn('⚠️  Could not create upload dir (read-only FS?):', err?.message);
}

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, MATERIALS_DIR),
  filename: (_req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 50) || 'file';
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

// Documents + images + video/audio recordings
const ALLOWED = /\.(pdf|ppt|pptx|doc|docx|zip|xlsx|xls|csv|txt|png|jpe?g|webp|gif|svg|mp4|webm|mov|mkv|avi|mp3|m4a|wav|ogg)$/i;

export const uploadFileLocal = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB — allows recording videos
  fileFilter: (_req: any, file: any, cb: any) => {
    if (ALLOWED.test(file.originalname)) cb(null, true);
    else cb(new Error('File type not allowed. Allowed: PDF, PPT, DOC, ZIP, XLSX, images, video, audio'));
  },
});
