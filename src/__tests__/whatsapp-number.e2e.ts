/* eslint-disable no-console */
/**
 * Which WhatsApp numbers a signup accepts.
 *
 * The rule was "eleven digits starting 01" and the shop found its edge: a
 * reader holding the printed book abroad could not activate it, because the
 * only field that would take their number would not take their country.
 *
 * What is pinned down here:
 *   • a number from anywhere is accepted, with or without spaces and dashes
 *   • a number that looks Bangladeshi is still held to the Bangladeshi shape,
 *     so a local typo is caught as it always was
 *   • +886 (Taiwan) is not mistaken for +88 (Bangladesh)
 *   • both signup schemas — auth and user — answer identically, which is the
 *     thing their comments have been promising each other for months
 *
 * Run: npx ts-node src/__tests__/whatsapp-number.e2e.ts
 */
import { isReachableNumber } from '../app/utils/phone';
import { registerValidationSchema } from '../app/modules/auth/auth.validation';
import { signupValidationSchema } from '../app/modules/user/user.validation';

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
};

const ACCEPTED: Array<[string, string]> = [
  ['01712345678', 'a Bangladeshi mobile, written the way it is spoken'],
  ['+8801712345678', 'the same number with its country code'],
  ['8801712345678', 'and without the plus'],
  ['0171-234-5678', 'dashes, as a phone keypad app would paste it'],
  ['01712 345678', 'a space in the middle'],
  ['+919876543210', 'India'],
  ['+14155552671', 'the United States'],
  ['+971501234567', 'the UAE, where a great many Bangladeshis are'],
  ['+886912345678', 'Taiwan — +886 is not +88 followed by a 6'],
  ['+44 7911 123456', 'the UK, spaced as the British write it'],
];

const REFUSED: Array<[string, string]> = [
  ['0171234567', 'a Bangladeshi number a digit short — the typo the old rule caught'],
  ['01212345678', 'an operator prefix that does not exist (012)'],
  ['12345', 'too short to be anyoneʼs number'],
  ['+1234567890123456', 'longer than any number on earth (E.164 stops at 15)'],
  ['abcd1234', 'letters'],
  ['', 'nothing at all'],
  ['   ', 'spaces'],
];

for (const [value, why] of ACCEPTED) {
  check(`accepts ${JSON.stringify(value)} — ${why}`, isReachableNumber(value));
}
for (const [value, why] of REFUSED) {
  check(`refuses ${JSON.stringify(value)} — ${why}`, !isReachableNumber(value));
}

// ── The two signup doors must answer the same ───────────────────────────
const body = (whatsappNumber: string) => ({
  body: {
    firstName: 'Test',
    lastName: 'Reader',
    email: 'reader@example.com',
    password: 'demo1234',
    whatsappNumber,
  },
});

const takes = (schema: { safeParse: (v: unknown) => { success: boolean } }, n: string) =>
  schema.safeParse(body(n)).success;

for (const [value] of [...ACCEPTED, ...REFUSED]) {
  const auth = takes(registerValidationSchema, value);
  const user = takes(signupValidationSchema, value);
  check(`both signup schemas agree on ${JSON.stringify(value)}`, auth === user, { auth, user });
}

check(
  'the public register schema now takes a foreign number',
  takes(registerValidationSchema, '+919876543210')
);
check(
  'and still refuses a local one with a digit missing',
  !takes(registerValidationSchema, '0171234567')
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
