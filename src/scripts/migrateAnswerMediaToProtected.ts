/* eslint-disable no-console */
/**
 * CLI wrapper for the answer-media migration.
 *
 * The logic itself lives in app/utils/migrateAnswerMedia so server.ts can run
 * it at boot — scripts/ is excluded from tsconfig and the Docker image, so
 * nothing shipped may import from here.
 *
 * The boot-time run makes this unnecessary in normal operation; it stays for a
 * manual dry run:
 *   npx ts-node src/scripts/migrateAnswerMediaToProtected.ts
 *   npx ts-node src/scripts/migrateAnswerMediaToProtected.ts --apply
 */
import mongoose from 'mongoose';
import { migrateAnswerMedia } from '../app/utils/migrateAnswerMedia';

(async () => {
  const apply = process.argv.includes('--apply');
  await import('../app/config');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  console.log(apply ? '── APPLYING ──' : '── DRY RUN ──');
  const res = await migrateAnswerMedia(apply, true);
  console.log(
    `\n✅ ${res.planned} planned, ${res.moved} file(s) moved, ${res.rewritten} URL(s) rewritten,` +
      ` ${res.skipped} skipped (file not on this machine).`
  );
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => {
  console.error('❌ Migration failed:', e);
  process.exit(1);
});
