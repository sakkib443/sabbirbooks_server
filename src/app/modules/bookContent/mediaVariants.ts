/**
 * Small copies of an answer figure.
 *
 * The figures are photographs and scans of book pages — three and four
 * megabytes each, uploaded straight from a phone and stored untouched. The
 * reader shows them in a 150px tile and, when tapped, on a phone screen. So
 * every reader on mobile data was paying for a print-resolution original twice
 * over, for a picture nothing could display at that size.
 *
 * Two smaller copies fix that. They sit beside the original, named after it:
 *
 *   1712345678901-figure.jpg              the original, untouched
 *   1712345678901-figure.jpg.thumb.webp   the grid tile
 *   1712345678901-figure.jpg.view.webp    what opens when it is tapped
 *
 * The name is APPENDED, never replaced, and nothing is written to the database:
 * questions, topics, chapters and every URL already stored in an answer stay
 * exactly as they are. The reader asks for a variant by adding the suffix, and
 * the media route makes it on first request if it is not there yet — so the
 * figures uploaded before any of this work the same as the ones after.
 *
 * The original is never modified or deleted. It stays the archive copy, and it
 * is what still answers if a variant cannot be made (a corrupt file, a format
 * sharp will not read).
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export const VARIANTS = {
  // The tile in the answer's image grid: two or three per row on a phone.
  thumb: { suffix: '.thumb.webp', width: 480, quality: 72 },
  // Tapped open, or embedded in the answer itself. 1600px still prints and
  // still zooms, at a twentieth of the weight.
  view: { suffix: '.view.webp', width: 1600, quality: 80 },
} as const;

export type VariantKind = keyof typeof VARIANTS;

/**
 * What sharp will read here. GIF and SVG are deliberately out: a GIF may be
 * animated and an SVG is already tiny and resolution-free, so both are better
 * served as they are.
 */
const CONVERTIBLE = /\.(jpe?g|png|webp|tiff?|avif|heic|heif)$/i;

export const isConvertibleImage = (fileName: string) => CONVERTIBLE.test(fileName);

/** For "x.jpg.thumb.webp" → { origin: "x.jpg", kind: "thumb" }; else null. */
export const variantOf = (fileName: string): { origin: string; kind: VariantKind } | null => {
  for (const kind of Object.keys(VARIANTS) as VariantKind[]) {
    const { suffix } = VARIANTS[kind];
    if (fileName.endsWith(suffix)) {
      const origin = fileName.slice(0, -suffix.length);
      return origin && isConvertibleImage(origin) ? { origin, kind } : null;
    }
  }
  return null;
};

export const variantName = (origin: string, kind: VariantKind) => `${origin}${VARIANTS[kind].suffix}`;

/**
 * One conversion at a time, and never the same file twice at once.
 *
 * Resizing a four-megapixel photograph costs a couple of hundred milliseconds
 * of CPU and a burst of memory. The VPS runs this shop beside several other
 * projects and has fallen over on memory before, so a page holding six figures
 * converts them one after another rather than all at once.
 */
const inFlight = new Map<string, Promise<boolean>>();
let queue: Promise<unknown> = Promise.resolve();

const convert = async (originPath: string, targetPath: string, kind: VariantKind): Promise<boolean> => {
  const { width, quality } = VARIANTS[kind];
  // Written to a temporary name first: a reader arriving mid-conversion would
  // otherwise be handed half a file, and half a file caches like a whole one.
  const temp = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await sharp(originPath, { failOn: 'none' })
      .rotate() // honours the phone's EXIF orientation, which resizing drops
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toFile(temp);
    fs.renameSync(temp, targetPath);
    return true;
  } catch (error: unknown) {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* nothing to clean up */
    }
    // eslint-disable-next-line no-console
    console.warn(
      `⚠️  Could not make ${kind} of ${path.basename(originPath)}:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
};

/**
 * The variant's path, making it first if it is missing.
 * Returns null when it cannot be made — the caller then serves the original.
 */
export async function ensureVariant(
  dir: string,
  origin: string,
  kind: VariantKind
): Promise<string | null> {
  if (!isConvertibleImage(origin)) return null;
  const originPath = path.join(dir, origin);
  const targetPath = path.join(dir, variantName(origin, kind));

  if (fs.existsSync(targetPath)) return targetPath;
  if (!fs.existsSync(originPath)) return null;

  const key = targetPath;
  if (!inFlight.has(key)) {
    const run = queue.then(() => convert(originPath, targetPath, kind));
    // The queue chains on completion, not on the result, so one bad file does
    // not stop the ones behind it.
    queue = run.catch(() => undefined);
    inFlight.set(
      key,
      run.finally(() => inFlight.delete(key))
    );
  }
  const made = await inFlight.get(key)!;
  return made ? targetPath : null;
}

/** Both copies, made at upload time so no reader ever waits for the first one. */
export async function makeVariants(dir: string, fileName: string): Promise<void> {
  if (!isConvertibleImage(fileName)) return;
  for (const kind of Object.keys(VARIANTS) as VariantKind[]) {
    await ensureVariant(dir, fileName, kind);
  }
}
