import crypto from 'crypto';

/**
 * Generating a book's copy code.
 *
 * THE REQUIREMENT, IN THE SHOP'S WORDS: "একটা বইয়ের কোড দেখে কখনো ধারণা করা
 * যাবে না আরেকটা বইয়ের কোড কি হতে পারে." One code must reveal nothing about
 * any other. That rules out everything convenient — a counter, a date, an
 * order id, the ISBN plus a serial, a hash of any of those. A buyer with one
 * book would work the pattern out and hand a thousand codes round a batch
 * group, and the shop would never know why sales stopped.
 *
 * So the code is random bytes from the operating system's CSPRNG, and nothing
 * else. `crypto.randomBytes`, not `Math.random()` — Math.random is a
 * predictable sequence seeded per process, so a few observed codes would give
 * away the rest, which is precisely the failure this must not have.
 *
 * HOW BIG
 *
 * 12 characters from a 30-letter alphabet is about 59 bits — 5.9 x 10^17
 * possibilities. Against a print run of even a million copies, a guesser
 * trying a code a second would expect to wait longer than the universe has
 * existed. The rate limit on redemption is the belt; this is the braces.
 *
 * WHAT THE ALPHABET LEAVES OUT
 *
 * A student is reading this off a scratch panel, on a phone, possibly in bad
 * light, and typing it into a form. So: no 0 or O, no 1 or I or L, no 5 or S,
 * no 8 or B, no 2 or Z. Every pair that gets misread is down to one member.
 * Dropping them costs a little entropy and buys back every support message
 * that would have started "it says my code is wrong".
 */

/** Unambiguous when read off a scratch panel and typed on a phone. */
const ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';

/** Groups of four, because a 12-character run is copied wrong. */
const GROUP = 4;

/** Prefix so a code is recognisable as ours in a support message. */
export const CODE_PREFIX = 'MV';

/**
 * One code. `MV-7K3P-9QXR-2M8T`.
 *
 * Rejection sampling rather than `% ALPHABET.length`: the modulo of a uniform
 * byte over 25 letters is NOT uniform — the first six letters would come up
 * about 25% more often than the rest — and a biased alphabet is a smaller
 * keyspace than it looks. Bytes that would bias the result are thrown away.
 */
export const generateCode = (length = 12): string => {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  const out: string[] = [];

  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte >= max) continue; // would bias — discard
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === length) break;
    }
  }

  const groups: string[] = [];
  for (let i = 0; i < out.length; i += GROUP) groups.push(out.slice(i, i + GROUP).join(''));
  return `${CODE_PREFIX}-${groups.join('-')}`;
};

/**
 * What the reader typed, as it is stored.
 *
 * People type codes with spaces, without dashes, in lower case, and with the
 * prefix left off because the panel prints it separately. All of those are the
 * same code, and refusing them teaches the reader that a correct code is
 * wrong. Anything that is not a code character is dropped, then the canonical
 * shape is rebuilt.
 *
 * Returns '' for something that cannot be a code, which the caller reports as
 * "not a valid code" without a database round trip.
 */
export const normalizeCode = (raw: string): string => {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const body = cleaned.startsWith(CODE_PREFIX) ? cleaned.slice(CODE_PREFIX.length) : cleaned;
  if (body.length < 8 || body.length > 24) return '';

  // Every character has to be one we actually print. Note that no confusable
  // character survives into the alphabet AT ALL — not 0 or O, not 1, I or L,
  // not 5 or S, 8 or B, 2 or Z; both members of every pair are excluded. So a
  // typed 'O' is a misread of something, and there is no way to know what:
  // "correcting" it to 0 would be inventing a character we never print. It is
  // reported as an invalid code instead, which is the truth.
  if (![...body].every((c) => ALPHABET.includes(c))) return '';

  const groups: string[] = [];
  for (let i = 0; i < body.length; i += GROUP) groups.push(body.slice(i, i + GROUP));
  return `${CODE_PREFIX}-${groups.join('-')}`;
};
