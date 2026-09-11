import jwt from 'jsonwebtoken';
import config from '../../config';

/**
 * Short-lived, user-bound token for protected answer media.
 *
 * Why this exists at all: an <img> or <video> tag cannot send an Authorization
 * header, so a route that only accepts Bearer auth is unreachable from the very
 * markup that needs it. The alternative — putting the real access JWT in the
 * query string — writes a full-privilege, long-lived credential into browser
 * history, Referer headers and every proxy log on the way. This token is
 * deliberately much weaker: media reads only, and it expires in minutes.
 *
 * It is minted only on responses that already passed an access check, so
 * holding one is never more than what the holder had just been granted.
 */

const MEDIA_TOKEN_TTL_SECONDS = 60 * 30;

type MediaTokenPayload = { sub: string; scope: 'media' };

export const signMediaToken = (userId: string): string =>
  jwt.sign({ sub: String(userId), scope: 'media' } satisfies MediaTokenPayload, config.jwt.access_secret, {
    expiresIn: MEDIA_TOKEN_TTL_SECONDS,
  });

/** userId the token was minted for, or null if it is invalid, expired, or not a media token. */
export const verifyMediaToken = (token: string): string | null => {
  try {
    const decoded = jwt.verify(token, config.jwt.access_secret) as Partial<MediaTokenPayload>;
    // The scope check is what stops a stolen *access* token — same secret, same
    // issuer — from being replayed here as if it were a media token, and vice
    // versa: a media token handed to authMiddleware carries no role, so it
    // cannot reach anything else.
    if (decoded?.scope !== 'media' || !decoded.sub) return null;
    return String(decoded.sub);
  } catch {
    return null;
  }
};

/**
 * Stamp every protected-media URL *inside* a string.
 *
 * A whole-string append would be wrong for `answerHtml`, which is a document
 * that may embed several <img src="…/media/x.png"> among ordinary prose — the
 * token has to land on each URL, not on the end of the article. Matching stops
 * at the characters that can legally end a URL in markup (quote, angle bracket,
 * whitespace, backslash) so the closing `"` is never swallowed.
 */
const MEDIA_URL_RE = /(https?:\/\/[^\s"'<>\\]*\/api\/book-content\/media\/[^\s"'<>\\?]+)/g;

/**
 * A protected-media URL with one or more `?t=…` tokens still hanging off it.
 *
 * Those should never exist at rest, and for a while they did. The admin editor
 * loads a question through the API — which stamps every media URL with a
 * fresh 30-minute token so the figures can render — and on save it sent the
 * URLs back exactly as it had received them. Nothing stripped the token, so
 * it was written into the database. Twenty-one questions were saved that way
 * over two weeks; the group `(?:…)+` is there because one of them had been
 * saved twice and carried two.
 *
 * The token class stops at `?` and `&` as well as the usual URL terminators,
 * so a doubled `?t=A?t=B` is consumed as two repetitions rather than one long
 * token, and nothing after a legitimate query separator could be eaten.
 */
const STALE_TOKEN_RE = /(\/api\/book-content\/media\/[^\s"'<>\\?]+)(?:\?t=[^\s"'<>\\?&]*)+/g;

/**
 * Remove every stale media token from the URLs inside a string.
 *
 * Only `/api/book-content/media/` URLs are touched. A YouTube link's `?si=`
 * or a PDF viewer's `?page=` is not a media token and is left alone — the
 * regex is anchored on our own media path and on the literal `t=` key.
 */
export const stripMediaTokens = (text: string): string =>
  text.includes('/api/book-content/media/') ? text.replace(STALE_TOKEN_RE, '$1') : text;

const stampUrlsIn = (text: string, token: string): string =>
  text.includes('/api/book-content/media/')
    ? // Strip first, then stamp, so a URL can never leave here carrying two
      // tokens (`…png?t=NEW?t=OLD`), which the browser sends as one garbage
      // token that fails verification.
      //
      // This alone does NOT rescue a row that was stored with a token: the
      // media route finds a file's owning question by matching the stored URL
      // anchored at its end, and a stored URL ending in "?t=…" never matches.
      // Rows like that are fixed by scripts/repairMediaTokens.ts, and new ones
      // cannot be written because sanitizeQuestionPayload strips on save.
      stripMediaTokens(text).replace(MEDIA_URL_RE, url => `${url}?t=${token}`)
    : text;

/**
 * Is this a `{}` literal, as opposed to an instance of some class?
 *
 * The walk below rebuilds every object it descends into, which destroys any
 * value whose meaning lives in its prototype. `.lean()` returns a plain object
 * at the TOP level, but its fields are still real BSON: `_id` is an ObjectId,
 * `createdAt` is a Date. Rebuilding an ObjectId from its own enumerable
 * properties yields `{ buffer: { 0: 106, 1: 142, … } }` — the raw bytes, with
 * `toJSON()` gone, so it serialises as that blob instead of the hex string.
 *
 * That is not cosmetic. The admin editor puts `_id` straight into the URL it
 * saves to, so every question PATCH went to `/questions/[object Object]` and
 * came back 400 "Cast to ObjectId failed" — editing, deleting and uploading an
 * image to a question were all dead, because none of them could be saved.
 *
 * Null-prototype objects count as plain: `Object.create(null)` is a bag of
 * data, and refusing to walk into one would silently skip its media URLs.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Append a media token to every protected-media URL in an arbitrary payload.
 *
 * Walks the object rather than naming each field: answer media hangs off
 * `videos[].url`, `attachments[].fileUrl` and `images[]`, and a fourth place
 * would otherwise be silently served without a token and 401 in the browser.
 */
const mapStrings = <T>(payload: T, fn: (s: string) => string): T => {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return fn(node);
    if (Array.isArray(node)) return node.map(walk);
    if (isPlainObject(node)) {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    // Anything else is returned untouched: no media URL can hide inside a
    // number, a Date or an ObjectId, so there is nothing here to gain by
    // descending into one — and everything to lose. See isPlainObject.
    return node;
  };
  return walk(payload) as T;
};

export const withMediaTokens = <T>(payload: T, userId: string): T => {
  const token = signMediaToken(userId);
  return mapStrings(payload, (s) => stampUrlsIn(s, token));
};

/**
 * The inverse, for the write side: a payload as it should be STORED.
 *
 * Same walk as withMediaTokens, so the two cannot disagree about where a media
 * URL might be hiding. Applied to every question create and update — see
 * sanitizeQuestionPayload — so a token that reaches the server on its way back
 * from the editor is dropped before the row is written, and the mistake that
 * produced twenty-one broken questions cannot be made again by anyone.
 */
export const withoutMediaTokens = <T>(payload: T): T => mapStrings(payload, stripMediaTokens);
