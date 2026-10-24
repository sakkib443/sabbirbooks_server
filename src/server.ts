// Importing config first loads environment variables (dotenv) before anything
// else runs, so process.env is populated for the DB connect util and app.
import config from './app/config';
import { dbConnect } from './app/utils/dbConnect';
import app from './app';

const PORT = config.port || 5000;

async function startServer() {
  // ─── DB connection is NON-FATAL ────────────────────────────────
  // If MongoDB is unreachable (e.g. no local mongod during Phase 1), we log a
  // warning and still start listening so the health check keeps working.
  let dbReady = false;
  try {
    await dbConnect();
    dbReady = true;
    console.log('🗄️  Database connected successfully');
  } catch (error) {
    console.warn(
      '⚠️  Database connection failed — starting server without DB.',
      (error as Error)?.message
    );
  }

  // ─── The shop's day cutoff, from Settings ───────────────────────
  //
  // Every order screen splits days at this hour (utils/shopDay). Before the
  // first request, so no list is ever cut at the wrong hour. Noon if unset.
  if (dbReady) {
    try {
      const { Settings } = await import('./app/modules/settings/settings.model');
      const { setShopDayCutoffHour } = await import('./app/utils/shopDay');
      const s: any = await Settings.findOne({}).select('shopDayCutoffHour').lean();
      if (s?.shopDayCutoffHour !== undefined) setShopDayCutoffHour(s.shopDayCutoffHour);
    } catch (error) {
      console.error('⚠️  Could not read the day cutoff (using noon):', error);
    }
  }

  // ─── One-time media migration, run on boot ─────────────────────
  //
  // Answer figures used to sit in the publicly-served uploads/materials. They
  // have to move into uploads/protected, and the move has to happen where the
  // volume is mounted — i.e. here, not from a laptop. Doing it at startup means
  // a deploy performs it with no shell step.
  //
  // Idempotent (a second run finds nothing to do), and non-fatal: the server
  // must still come up if it fails, or one bad file would take the site down.
  // It only rewrites a URL whose file it can actually see, so a run without the
  // volume attached is a no-op rather than a mass-breakage.
  if (dbReady) {
    try {
      const { migrateAnswerMedia } = await import('./app/utils/migrateAnswerMedia');
      const res = await migrateAnswerMedia(true);
      if (res.moved || res.rewritten) {
        console.log(
          `🔒 Answer media secured — ${res.moved} file(s) moved, ${res.rewritten} URL(s) rewritten.`
        );
      }
      if (res.skipped) {
        console.warn(`⚠️  ${res.skipped} media reference(s) skipped — file not found on disk.`);
      }
    } catch (error) {
      console.error('⚠️  Answer-media migration failed (server still starting):', error);
    }
  }

  // ─── English copy for the site's English mode ──────────────────
  //
  // Fills only English fields that are still blank, and only beside the exact
  // Bengali it translates — see fillEnglishContent. Non-fatal like the rest.
  if (dbReady) {
    try {
      const { fillEnglishContent } = await import('./app/utils/fillEnglishContent');
      const n = await fillEnglishContent();
      if (n) console.log(`🌐 English copy filled on ${n} document(s).`);
    } catch (error) {
      console.error('⚠️  English-copy fill failed (server still starting):', error);
    }
  }

  // ─── The demo recorded course, once ─────────────────────────────
  //
  // The shop asked for a demo course in the live database (25 Oct 2026). Put
  // in on the first boot that has this code and never again: the date in
  // Settings remembers it, so deleting the demo later keeps it deleted.
  if (dbReady) {
    try {
      const { Settings } = await import('./app/modules/settings/settings.model');
      const s: any = await Settings.findOne({}).select('demoCourseSeededAt').lean();
      if (!s?.demoCourseSeededAt) {
        const { createDemoCourse } = await import('./app/modules/courses/demoCourse');
        const { created } = await createDemoCourse();
        await Settings.updateOne({}, { $set: { demoCourseSeededAt: new Date() } }, { upsert: true });
        if (created) console.log('🎬 Demo recorded course added.');
      }
    } catch (error) {
      console.error('⚠️  Demo course step failed (server still starting):', error);
    }
  }

  // ─── The demo course is paid: no free class ─────────────────────
  //
  // Its first class was a free preview; the shop wants nothing free (25 Oct
  // 2026). Once, remembered in Settings, so a class the shop marks free later
  // in the editor stays free.
  if (dbReady) {
    try {
      const { Settings } = await import('./app/modules/settings/settings.model');
      const s: any = await Settings.findOne({}).select('demoCoursePaidOnlyAt').lean();
      if (!s?.demoCoursePaidOnlyAt) {
        const { makeDemoCoursePaidOnly } = await import('./app/modules/courses/demoCourse');
        const n = await makeDemoCoursePaidOnly();
        await Settings.updateOne({}, { $set: { demoCoursePaidOnlyAt: new Date() } }, { upsert: true });
        if (n) console.log(`🔒 Demo course: ${n} free class(es) now paid.`);
      }
    } catch (error) {
      console.error('⚠️  Demo course paid-only step failed (server still starting):', error);
    }
  }

  // ─── Seed the medical-college directory, once ──────────────────
  //
  // Students pick their college from this list at signup, so it has to exist
  // before the first signup — not after someone remembers to run a script.
  // Insert-only: a name or district the admin corrected in the panel is never
  // overwritten by a later deploy. Non-fatal for the same reason as above.
  if (dbReady) {
    try {
      const { MedicalCollegeService } = await import(
        './app/modules/medicalCollege/medicalCollege.service'
      );
      const { inserted } = await MedicalCollegeService.seedFromFile();
      if (inserted) console.log(`🎓 Medical college directory — ${inserted} added.`);
      // Campus Ambassador coupon codes start with the college's abbreviation
      // (DMC + SAKIB + 20), and the 112 rows were seeded before that existed.
      // Fills blanks only, so a corrected abbreviation survives every deploy.
      const filled = await MedicalCollegeService.backfillAbbreviations();
      if (filled) console.log(`🔤 College abbreviations — ${filled} filled in.`);
      // The checkout matches a college's delivery rate on its upazila, and the
      // rows were seeded without one. Fills blanks only.
      const upazilas = await MedicalCollegeService.backfillUpazilas();
      if (upazilas) console.log(`📍 College upazilas — ${upazilas} filled in.`);
      // Once: the Khulna rules move from Settings onto the college rows.
      const moved = await MedicalCollegeService.migrateLegacyDeliveryRates();
      if (moved.length) console.log(`🚚 Delivery rates moved onto colleges — ${moved.join(', ')}`);
    } catch (error) {
      console.error('⚠️  College seed failed (server still starting):', error);
    }
  }

  // ─── Close the old master-key account ──────────────────────────
  //
  // Its password was published in this public repository and used to log in
  // as superAdmin before the database was even asked. The check is gone from
  // the login path; this makes sure the account it may have created is not
  // still sitting in the database on that same password. A no-op once done,
  // and on any account whose password was already changed. See
  // RETIRED_DEFAULT_ADMIN in auth.service.ts.
  if (dbReady) {
    try {
      const { AuthService } = await import('./app/modules/auth/auth.service');
      if (await AuthService.retireDefaultAdminPassword()) {
        console.warn('🔒 The old master-key admin account was still on its published password — it has been replaced and the account signed out. An admin can set a new one from Users.');
      }
    } catch (error) {
      console.error('⚠️  Default admin check failed (server still starting):', error);
    }
  }

  // ─── The owner's super admin accounts, from the environment ─────
  //
  // SUPERADMIN_EMAILS (comma-separated) names the accounts that must be super
  // admins. An admin now sees only the last fifteen days, and only a super
  // admin can make another — so without this an owner whose account is an
  // "admin" would be locked out of their own history with no way back in.
  // Only someone who can change the server's environment can use it. It only
  // ever promotes the named, existing accounts; it never demotes anyone.
  if (dbReady && process.env.SUPERADMIN_EMAILS) {
    try {
      const { User } = await import('./app/modules/user/user.model');
      const emails = String(process.env.SUPERADMIN_EMAILS)
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      // A deleted user is only hidden (isDeleted), and its email stays taken —
      // so an owner who once deleted the account they now want as super admin
      // could neither find it nor sign up with it again. A named account is
      // brought back as well: undeleted, active, super admin. (Its password is
      // whatever it was; "Forgot password" sets a new one.)
      const res = await User.updateMany(
        {
          email: { $in: emails },
          $or: [{ role: { $ne: 'superAdmin' } }, { isDeleted: true }, { status: { $ne: 'active' } }],
        },
        { $set: { role: 'superAdmin', isDeleted: false, status: 'active' } }
      );
      if (res.modifiedCount) console.log(`👑 ${res.modifiedCount} account(s) made super admin from SUPERADMIN_EMAILS.`);
    } catch (error) {
      console.error('⚠️  SUPERADMIN_EMAILS step failed (server still starting):', error);
    }
  }

  // ─── Staff devices already signed in count as approved ─────────
  //
  // New staff devices now wait for the Super Admin (security.service). The
  // devices staff are using today were never asked, so they are approved here,
  // once — switching the check on signs nobody out. Insert-only.
  if (dbReady) {
    try {
      const { SecurityService } = await import('./app/modules/security/security.service');
      const n = await SecurityService.approveExistingSessions();
      if (n) console.log(`🔐 ${n} staff device(s) already signed in — marked approved.`);
    } catch (error) {
      console.error('⚠️  Staff device sync failed (server still starting):', error);
    }
  }

  // ─── Book-order lines out of the staff bell ─────────────────────
  //
  // New orders no longer notify staff (orderAlert.service). The ones already
  // in the bell are hidden too — soft (isDeleted), so nothing is lost. A no-op
  // once done.
  if (dbReady) {
    try {
      const { Notification } = await import('./app/modules/notification/notification.model');
      const r = await Notification.updateMany(
        { title: /^🛒 নতুন বই অর্ডার/, isDeleted: false },
        { $set: { isDeleted: true } }
      );
      if (r.modifiedCount) console.log(`🔕 ${r.modifiedCount} old book-order notification(s) hidden from the staff bell.`);
    } catch (error) {
      console.error('⚠️  Notification cleanup failed (server still starting):', error);
    }
  }

  // ─── Close checkouts that were abandoned at the gateway ────────
  //
  // An order is written before the buyer is sent to SSLCommerz, so a buyer who
  // opens the payment page and closes the tab leaves one behind. SSLCommerz
  // only calls back when someone presses Cancel or the payment is declined —
  // the commonest abandonment presses nothing at all, so nothing ever tells us.
  // Without this those orders sit in the admin's pending queue for ever.
  //
  // An interval rather than a cron container: one process runs this service, the
  // sweep is idempotent, and a missed tick costs nothing but a later cleanup.
  // unref() so it never holds the process open during a shutdown.
  if (dbReady) {
    const SWEEP_EVERY_MS = 15 * 60_000;
    const sweep = async () => {
      try {
        const { OrderService } = await import('./app/modules/order/order.service');
        const closed = await OrderService.expireAbandonedGatewayOrders();
        if (closed) console.log(`🧹 Closed ${closed} abandoned gateway checkout(s).`);
      } catch (error) {
        console.error('⚠️  Abandoned-order sweep failed (server unaffected):', error);
      }
    };
    void sweep(); // once at boot, to clear whatever accumulated before this shipped
    setInterval(sweep, SWEEP_EVERY_MS).unref();
  }

  // ─── Courier: keep parcel statuses and payouts in step ───────────
  //
  // Steadfast's webhook does this the moment something changes, when it is set
  // up; this is the safety net for when it is not, or a call was missed. Every
  // 30 minutes, only when the courier keys are present, and never fatal.
  if (dbReady) {
    const COURIER_EVERY_MS = 30 * 60_000;
    const courierTick = async () => {
      try {
        const { steadfastConfigured } = await import('./app/modules/courier/steadfast.client');
        if (!steadfastConfigured()) return;
        const { CourierService } = await import('./app/modules/courier/courier.service');
        const st = await CourierService.syncStatuses({ limit: 300 });
        if (st.changed) console.log(`📦 Courier: ${st.changed} parcel status update(s).`);
        const r = st.reconciled;
        if (r && (r.delivered || r.shipped)) console.log(`📦 Courier: ${r.delivered} order(s) marked delivered, ${r.shipped} shipped, to match their parcels.`);
        await CourierService.syncPayments();
      } catch (error) {
        console.error('⚠️  Courier sync failed (server unaffected):', error);
      }
    };
    // Once: tracking links stored as Steadfast's /t/ page (which no longer
    // opens for these codes) now point at the shop's own tracking page.
    void (async () => {
      try {
        const { Order } = await import('./app/modules/order/order.model');
        const { publicSiteUrl } = await import('./app/modules/courier/steadfast.client');
        const r = await Order.updateMany(
          { trackingUrl: /^https:\/\/steadfast\.com\.bd\/t\//, 'courier.trackingCode': { $nin: [null, ''] } },
          [{ $set: { trackingUrl: { $concat: [`${publicSiteUrl()}/t/`, '$courier.trackingCode'] } } }]
        );
        if (r.modifiedCount) console.log(`🔗 ${r.modifiedCount} tracking link(s) moved to the shop's tracking page.`);
      } catch (error) {
        console.error('⚠️  Tracking-link update failed (server unaffected):', error);
      }
    })();
    setTimeout(courierTick, 60_000).unref();
    setInterval(courierTick, COURIER_EVERY_MS).unref();
  }

  app.listen(PORT, () => {
    console.log(`🚀 Sabbir Book Server is running on http://localhost:${PORT}`);
  });
}

startServer();
