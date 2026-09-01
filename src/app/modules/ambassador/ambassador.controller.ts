/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { AmbassadorService } from './ambassador.service';
import { AmbassadorApplication } from './ambassador.model';
import { PROTECTED_MEDIA_DIR } from '../../config/localUpload';
import { hasCapability } from '../../config/permissions';
import { User } from '../user/user.model';

const uid = (req: Request) => (req as any).user?._id || (req as any).user?.id;

/** The site's own origin, for building an absolute file URL. */
const publicBaseUrl = (req: Request): string => {
  const configured = (process.env.SERVER_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
};

// ─── Public: apply ───────────────────────────────────────────

const apply = async (req: Request, res: Response) => {
  try {
    const { agreement, ...rest } = req.body || {};
    const app = await AmbassadorService.apply(rest);
    res.status(201).json({
      success: true,
      message: 'Application received',
      // Only what the applicant needs to quote back at us. The rest of the
      // document — status, notes, anything a reviewer writes — is not theirs.
      data: { applicationId: app.applicationId, status: app.status },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/ambassador/id-card — the applicant's college ID.
 *
 * Public, because the form is filled in before anyone has an account, and
 * unauthenticated by necessity rather than by oversight. Two things keep that
 * safe: the file lands in the protected directory (never served by
 * express.static), and reading it back goes through serveIdCard below, which
 * only staff and the ambassador themselves get past.
 */
const uploadIdCard = async (req: Request, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    res.status(200).json({
      success: true,
      data: {
        url: `${publicBaseUrl(req)}/api/ambassador/id-card/${file.filename}`,
        fileName: file.filename,
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/ambassador/id-card/:fileName — read one back.
 *
 * A student's ID card is a personal document. Two callers may see it: staff who
 * review applications, and the ambassador it belongs to. Nobody else, and never
 * anonymously — which is why this route exists at all instead of dropping the
 * file into the public uploads mount.
 */
const serveIdCard = async (req: Request, res: Response) => {
  try {
    // basename first: strips any ../ before it can escape the directory. The
    // whitelist then rejects anything multer would never have written.
    const fileName = path.basename(req.params.fileName || '');
    if (!fileName || !/^[A-Za-z0-9._-]+$/.test(fileName)) {
      return res.status(400).json({ success: false, message: 'Bad file name' });
    }

    const userId = uid(req);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const app: any = await AmbassadorApplication.findOne({
      idCardUrl: { $regex: `/${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` },
    })
      .select('user')
      .lean();
    if (!app) return res.status(404).json({ success: false, message: 'Not found' });

    const isOwner = app.user && String(app.user) === String(userId);
    let allowed = Boolean(isOwner);
    if (!allowed) {
      const staff: any = await User.findById(userId).select('role permissions').lean();
      allowed = Boolean(staff && hasCapability(staff.role, staff.permissions, 'users.read'));
    }
    if (!allowed) return res.status(403).json({ success: false, message: 'No access to this file' });

    const filePath = path.join(PROTECTED_MEDIA_DIR, fileName);
    if (!path.resolve(filePath).startsWith(path.resolve(PROTECTED_MEDIA_DIR))) {
      return res.status(400).json({ success: false, message: 'Bad file name' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    // private: this is one person's document — no shared cache may keep a copy
    // and hand it to the next requester.
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(filePath);
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Admin ───────────────────────────────────────────────────

const list = async (req: Request, res: Response) => {
  try {
    const [data, counts] = await Promise.all([
      AmbassadorService.list(req.query as any),
      AmbassadorService.getCounts(),
    ]);
    res.status(200).json({ success: true, data, counts });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getById = async (req: Request, res: Response) => {
  try {
    const data = await AmbassadorService.getById(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(404).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/ambassador/:id/status — the one button that runs the programme.
 *
 * Approving mints the coupon and the login; rejecting or suspending takes the
 * coupon offline. Both live in the service so the two systems are wired
 * together in exactly one place.
 */
const review = async (req: Request, res: Response) => {
  try {
    const data = await AmbassadorService.setStatus(req.params.id, req.body.status, {
      reviewerId: String(uid(req) || ''),
      adminNote: req.body.adminNote,
    });
    res.status(200).json({ success: true, message: `Application ${req.body.status}`, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/ambassador — add an affiliate by hand.
 *
 * Not everyone who sells for the shop comes through the public form. This
 * creates the record, the coupon and the login in one step, because an admin
 * typing someone in IS the approval.
 */
const create = async (req: Request, res: Response) => {
  try {
    const data = await AmbassadorService.createManual(req.body, String(uid(req) || ''));
    res.status(201).json({ success: true, message: 'Affiliate added', data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/** PATCH /api/ambassador/:id — edit everything the shop knows about them. */
const update = async (req: Request, res: Response) => {
  try {
    const data = await AmbassadorService.update(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Affiliate updated', data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/** DELETE /api/ambassador/:id — remove the record; the coupon is kept, dark. */
const remove = async (req: Request, res: Response) => {
  try {
    const data = await AmbassadorService.remove(req.params.id);
    res.status(200).json({
      success: true,
      message: data.couponKept
        ? `Removed. Coupon ${data.couponKept} was switched off, not deleted — past orders still reference it.`
        : 'Removed',
      data,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const setNote = async (req: Request, res: Response) => {
  try {
    const data = await AmbassadorService.setAdminNote(req.params.id, req.body.adminNote);
    res.status(200).json({ success: true, message: 'Note saved', data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── The ambassador's own view ───────────────────────────────

const getMine = async (req: Request, res: Response) => {
  try {
    const data = await AmbassadorService.getMine(String(uid(req) || ''));
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const AmbassadorController = {
  apply,
  create,
  update,
  remove,
  uploadIdCard,
  serveIdCard,
  list,
  getById,
  review,
  setNote,
  getMine,
};
