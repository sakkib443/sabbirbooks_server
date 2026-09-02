/**
 * Building an ambassador's coupon code.
 *
 * The shape the shop asked for is  <COLLEGE><NAME>20  — DMCSAKIB20 — where the
 * 20 is the ৳20 a buyer saves. It has to be short enough to type from a Facebook
 * post and recognisable enough that a student can tell whose code it is.
 *
 * Two applicants can land on the same one: a DMC Sakib and another DMC Sakib.
 * The code is unique in the database, so the second must differ, and it must
 * differ in a way that is still *theirs* rather than a random string — that is
 * what makes it repeatable if it ever has to be rebuilt.
 */
import { BookCoupon } from '../bookCoupon/bookCoupon.model';
import { AMBASSADOR_DISCOUNT_TK } from './ambassador.model';

/** Letters only, upper case — what a coupon code may contain. */
const letters = (s?: string): string =>
  String(s || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

/**
 * The name part of the code.
 *
 * The applicant's own call-name wins when they give one. The form asks for it
 * ("ডাক নাম") precisely because guessing is unreliable: "Md. Sakib Al Hasan"
 * could reasonably become SAKIB, HASAN or AL, and the person selling under the
 * code is the one who knows which one their classmates would recognise.
 *
 * With no nickname we still have to guess, and the guess is: the longest word
 * that is not an honorific. In Bangladesh that lands on the given name far more
 * often than taking the first or last word does.
 *
 * Capped at 8 letters either way — "MOSTAFIZURRAHMAN20" is not a code anyone
 * types twice.
 */
const HONORIFICS = new Set(['MD', 'MOHAMMAD', 'MOHAMMED', 'MST', 'MRS', 'MR', 'DR', 'MISS']);

export const namePart = (fullName: string, nickname?: string): string => {
  // A nickname is a deliberate answer to "what should the code say?", so it is
  // taken as given — no honorific filtering, no longest-word guessing.
  const nick = letters(nickname);
  if (nick.length >= 2) return nick.slice(0, 8);

  const words = String(fullName || '')
    .split(/\s+/)
    .map(letters)
    .filter((w) => w.length >= 2 && !HONORIFICS.has(w));

  if (!words.length) return 'AMB';
  // The longest word is the given name far more often than the first is, once
  // honorifics are out of the way.
  const pick = words.reduce((best, w) => (w.length > best.length ? w : best), words[0]);
  return pick.slice(0, 8);
};

/** `DMC` + `SAKIB` + `20`, before any uniqueness suffix. */
export const baseCouponCode = (
  collegeAbbr: string,
  fullName: string,
  nickname?: string
): string =>
  `${letters(collegeAbbr) || 'MVA'}${namePart(fullName, nickname)}${AMBASSADOR_DISCOUNT_TK}`;

/**
 * A code no other coupon holds.
 *
 * The base code first — almost every ambassador gets exactly what the shop
 * described. Only a genuine clash adds anything, and what it adds is the tail of
 * their own phone number: two digits, then three, then four. That keeps the code
 * theirs (rebuildable from their own record), keeps it typable, and cannot
 * collide with a differently-named person the way a counter would.
 *
 * The final fallback is a short random tail — reached only if someone shares a
 * college, a name AND a whole phone number with an existing ambassador, which
 * means something is wrong with the data rather than with the code.
 */
export const uniqueCouponCode = async (
  collegeAbbr: string,
  fullName: string,
  phone: string,
  nickname?: string
): Promise<string> => {
  const base = baseCouponCode(collegeAbbr, fullName, nickname);
  const digits = String(phone || '').replace(/\D/g, '');

  const candidates = [base];
  for (const n of [2, 3, 4]) {
    if (digits.length >= n) candidates.push(`${base}${digits.slice(-n)}`);
  }

  for (const code of candidates) {
    const taken = await BookCoupon.exists({ code });
    if (!taken) return code;
  }

  // Deliberately a loop with a bound rather than while(true): a bug that made
  // every candidate look taken would otherwise hang the approval request.
  for (let i = 0; i < 20; i++) {
    const tail = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const code = `${base}${tail}`;
    if (!(await BookCoupon.exists({ code }))) return code;
  }

  throw new Error('Could not generate a unique coupon code — please set one by hand.');
};
