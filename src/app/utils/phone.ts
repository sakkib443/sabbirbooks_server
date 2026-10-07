/**
 * Is this a number a person could actually be reached on?
 *
 * The shop asks every customer for a WhatsApp number, and until now the rule
 * was "eleven digits starting 01" — a Bangladeshi mobile and nothing else.
 * That is right for almost every buyer and wrong for the ones who matter at
 * the edge: a student doing a clinical attachment abroad, a Bangladeshi in
 * Malaysia or the Gulf buying for a sibling at home. They hold the printed
 * book and the code inside it, and the form would not let them activate it.
 *
 * So a number from anywhere is accepted — but a number that LOOKS local is
 * still held to the local rule. Dropping that would be a quiet loss: almost
 * every number typed into this site is Bangladeshi, and "01712 34567" with a
 * digit missing is a typo the old rule caught and a loose international one
 * would wave through, leaving the shop with a number that reaches nobody.
 *
 * What counts as local: digits that begin with a 0, with or without an 88 in
 * front. A country code of its own that happens to start 88 (Taiwan's +886,
 * say) does not qualify — the 0 has to be there.
 */

/** Shortest plausible national number (Saint Helena's are five, nobody's are four). */
export const MIN_PHONE_DIGITS = 7;
/** E.164's own ceiling: no telephone number on earth is longer. */
export const MAX_PHONE_DIGITS = 15;

// Everything a person might type around the digits: +, spaces, dashes,
// brackets, the occasional dot. Letters are not a phone number.
const PHONE_SHAPE = /^\+?[\d\s().-]+$/;

const BANGLADESHI = /^(?:88)?01[3-9]\d{8}$/;
const LOOKS_BANGLADESHI = /^(?:88)?0\d+$/;

export const isReachableNumber = (raw: unknown): boolean => {
  const value = String(raw ?? '').trim();
  if (!value || !PHONE_SHAPE.test(value)) return false;

  const digits = value.replace(/\D/g, '');
  if (LOOKS_BANGLADESHI.test(digits)) return BANGLADESHI.test(digits);

  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
};

/** One wording, so both signup doors say the same thing. */
export const WHATSAPP_NUMBER_MESSAGE =
  'Give a valid WhatsApp number — 01712345678, or with its country code if it is not Bangladeshi (+919876543210)';
