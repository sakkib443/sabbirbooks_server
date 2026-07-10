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
  try {
    await dbConnect();
    console.log('🗄️  Database connected successfully');
  } catch (error) {
    console.warn(
      '⚠️  Database connection failed — starting server without DB.',
      (error as Error)?.message
    );
  }

  app.listen(PORT, () => {
    console.log(`🚀 Sabbir Book Server is running on http://localhost:${PORT}`);
  });
}

startServer();
