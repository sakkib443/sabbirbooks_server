/* eslint-disable no-console */
/**
 * One-time (idempotent) rewrite of stored media URLs from the old backend origin
 * to the public site origin.
 *
 * Files uploaded before the same-origin proxy landed had their URL built from
 * the request host — a *.sslip.io backend domain some networks block — and that
 * absolute URL is baked into the DB (book-content figures/videos/attachments,
 * the site logo, notices, etc.). This walks every collection and replaces any
 * `http(s)://<OLD_HOST>` occurrence inside string values with NEW_ORIGIN, so the
 * frontend's /uploads rewrite can serve them from the site's own domain.
 *
 * Usage (defaults shown):
 *   OLD_HOST=sxygeronwx1p799pbax4t4lv.164.68.126.31.sslip.io \
 *   NEW_ORIGIN=https://magicviva.com \
 *   npx ts-node src/scripts/rewriteMediaOrigin.ts
 */
import mongoose from 'mongoose';

const OLD_HOST =
  process.env.OLD_HOST || 'sxygeronwx1p799pbax4t4lv.164.68.126.31.sslip.io';
const NEW_ORIGIN = (process.env.NEW_ORIGIN || 'https://magicviva.com').replace(/\/+$/, '');

// Matches http:// or https:// (or protocol-relative //) + the old host, keeping
// the path that follows. Escapes dots in the host so they are literal.
const RE = new RegExp(`(?:https?:)?//${OLD_HOST.replace(/\./g, '\\.')}`, 'g');

// Deep-replace inside any JSON-ish value; returns [newValue, changedCount].
const rewrite = (value: unknown): [unknown, number] => {
  if (typeof value === 'string') {
    let n = 0;
    const out = value.replace(RE, () => {
      n++;
      return NEW_ORIGIN;
    });
    return [out, n];
  }
  if (Array.isArray(value)) {
    let n = 0;
    const out = value.map((v) => {
      const [nv, c] = rewrite(v);
      n += c;
      return nv;
    });
    return [out, n];
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    let n = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const [nv, c] = rewrite(v);
      n += c;
      out[k] = nv;
    }
    return [out, n];
  }
  return [value, 0];
};

export const rewriteMediaOrigin = async (): Promise<{ docs: number; occurrences: number }> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No DB connection');
  const collections = await db.listCollections().toArray();

  let docsChanged = 0;
  let occurrences = 0;

  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    const col = db.collection(name);
    const cursor = col.find({});
    for await (const doc of cursor) {
      const { _id, ...rest } = doc;
      const [next, count] = rewrite(rest);
      if (count > 0) {
        await col.updateOne({ _id }, { $set: next as Record<string, unknown> });
        docsChanged++;
        occurrences += count;
      }
    }
  }
  return { docs: docsChanged, occurrences };
};

if (require.main === module) {
  (async () => {
    await import('../app/config');
    const { dbConnect } = await import('../app/utils/dbConnect');
    await dbConnect();
    console.log(`Rewriting //${OLD_HOST}  →  ${NEW_ORIGIN}`);
    const res = await rewriteMediaOrigin();
    console.log(`✅ Media origin rewrite: ${res.docs} docs, ${res.occurrences} URLs updated`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => {
    console.error('❌ rewrite failed:', e);
    process.exit(1);
  });
}
