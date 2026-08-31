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
    } catch (error) {
      console.error('⚠️  College seed failed (server still starting):', error);
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

  app.listen(PORT, () => {
    console.log(`🚀 Sabbir Book Server is running on http://localhost:${PORT}`);
  });
}

startServer();
