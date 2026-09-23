/* eslint-disable no-console */
/**
 * Make the small copies of every picture already uploaded.
 *
 * The media route makes them on first request, so nothing has to run this — it
 * only moves the work off the readers. Run it once after the deploy and the
 * first student to open each topic gets the light copy straight away instead of
 * waiting for it to be made.
 *
 * It only ADDS files:
 *   figure.jpg          untouched, still the archive copy
 *   figure.jpg.thumb.webp   new
 *   figure.jpg.view.webp    new
 *
 * Nothing is read from or written to the database. No original is modified,
 * renamed or deleted, so no answer, topic, chapter or link can be affected.
 *
 * DRY RUN BY DEFAULT — it prints what it would make, and what that would save.
 *
 *   npx ts-node --transpile-only src/scripts/makeMediaVariants.ts
 *   APPLY=1 npx ts-node --transpile-only src/scripts/makeMediaVariants.ts
 */
import fs from 'fs';
import path from 'path';
import { MATERIALS_DIR, PROTECTED_MEDIA_DIR } from '../app/config/localUpload';
import { VARIANTS, ensureVariant, isConvertibleImage, variantName } from '../app/modules/bookContent/mediaVariants';

const APPLY = process.env.APPLY === '1';
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const sizeOf = (file: string) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

const walk = async (dir: string, label: string) => {
  if (!fs.existsSync(dir)) {
    console.log(`\n${label}: ${dir} — not here, skipping.`);
    return;
  }
  const names = fs
    .readdirSync(dir)
    .filter((name) => isConvertibleImage(name))
    // A copy is itself a .webp; it must not be copied again.
    .filter((name) => !Object.values(VARIANTS).some((v) => name.endsWith(v.suffix)));

  console.log(`\n${label}: ${names.length} picture${names.length === 1 ? '' : 's'} in ${dir}`);

  let made = 0;
  let skipped = 0;
  let failed = 0;
  let originalBytes = 0;
  let copyBytes = 0;

  for (const name of names) {
    originalBytes += sizeOf(path.join(dir, name));
    for (const kind of Object.keys(VARIANTS) as (keyof typeof VARIANTS)[]) {
      const target = path.join(dir, variantName(name, kind));
      if (fs.existsSync(target)) {
        skipped++;
        copyBytes += sizeOf(target);
        continue;
      }
      if (!APPLY) {
        made++;
        continue;
      }
      const result = await ensureVariant(dir, name, kind);
      if (result) {
        made++;
        copyBytes += sizeOf(result);
      } else {
        failed++;
      }
    }
  }

  console.log(`  ${APPLY ? 'made' : 'would make'}: ${made}   already there: ${skipped}   could not: ${failed}`);
  console.log(`  originals on disk: ${mb(originalBytes)}${APPLY ? `   copies: ${mb(copyBytes)}` : ''}`);
};

const main = async () => {
  console.log(
    APPLY
      ? '\n⚠  APPLYING — writing the small copies. Originals are not touched.\n'
      : '\nDry run. Nothing is written. Pass APPLY=1 to make the copies.\n'
  );
  await walk(PROTECTED_MEDIA_DIR, 'Answer figures');
  await walk(MATERIALS_DIR, 'Covers and public files');
  console.log('\nDone.\n');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
