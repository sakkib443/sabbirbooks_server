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
      const { migrateAnswerMedia } = await import('./scripts/migrateAnswerMediaToProtected');
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

  app.listen(PORT, () => {
    console.log(`🚀 Sabbir Book Server is running on http://localhost:${PORT}`);
  });
}

startServer();
