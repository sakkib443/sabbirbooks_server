// src/app/modules/auth/google.verify.ts
//
// ════════════════════════════════════════════════════════════════════════════
//  THE TRUST BOUNDARY FOR "SIGN IN WITH GOOGLE"
// ════════════════════════════════════════════════════════════════════════════
//
// Everything the browser sends about a Google user is untrusted EXCEPT what
// comes back out of this module. The retired /api/user/google-login endpoint is
// the cautionary tale: it read { firstName, email, googleId } straight off the
// request body, looked the account up by that email and signed a JWT carrying
// the account's real role. Any unauthenticated caller could name the superAdmin
// address and be handed the superAdmin account.
//
// The fix is not "validate the body harder" — an email in a request body can
// never be evidence of anything. The only evidence is a Google-issued ID token:
// a JWT signed by Google, carrying the user's identity, minted for OUR client
// id. verifyIdToken() below checks the signature against Google's published
// keys, checks the issuer, and checks that the token was minted for us. A token
// stolen from another site fails the audience check; a hand-written token fails
// the signature check.
//
// ── Why email_verified is not optional ─────────────────────────────────────
// A Google account can exist with an unverified email address (self-signup with
// an address you do not control). If we linked on email alone, an attacker
// could register a Google account claiming admin@sabbirbook.com and — even with
// a perfectly valid, correctly-audienced ID token — be linked straight into the
// real account. The verified flag is what turns "claims this email" into "owns
// this email", so a token without it is rejected outright.
//
// ── Defence in depth ───────────────────────────────────────────────────────
// verifyIdToken() already enforces signature, issuer, audience and expiry. The
// re-checks below look redundant and are deliberate: this module is the single
// choke point, the verifier is injectable for tests, and a stub that forgets a
// check must not be able to wave a token through.

import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import config from '../../config';

/** The only two `iss` values a genuine Google ID token ever carries. */
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Grace allowed on the backstop expiry check below, in seconds.
 *
 * verifyIdToken() is the authoritative expiry check and has no grace. This
 * second check only exists so a stubbed/broken verifier cannot pass an expired
 * token through, so a little slack costs nothing and guarantees the backstop
 * can never reject a token the real library just accepted.
 */
const EXPIRY_GRACE_SECONDS = 60;

/** A verified Google user. Every field here has been proven by Google. */
export interface GoogleIdentity {
  /** The `sub` claim: stable, unique, never reused. The real primary key. */
  googleId: string;
  /** Lower-cased and PROVEN to be verified — see email_verified above. */
  email: string;
  firstName: string;
  lastName: string;
  /** https avatar URL, or '' when Google sent none/something unusable. */
  image: string;
}

export type GoogleAuthErrorCode =
  | 'not_configured'
  | 'missing_token'
  | 'invalid_token'
  | 'email_unverified'
  | 'email_missing';

/** Carries an HTTP status so the controller never has to guess at one. */
export class GoogleAuthError extends Error {
  readonly status: number;
  readonly code: GoogleAuthErrorCode;

  constructor(code: GoogleAuthErrorCode, message: string, status: number) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
    this.status = status;
    // Belt and braces: keeps `instanceof` working if the build target is ever
    // dropped to es5, where TS downlevels Error subclasses and breaks it.
    Object.setPrototypeOf(this, GoogleAuthError.prototype);
  }
}

/**
 * Every client id whose tokens this server will accept.
 *
 * ── Why a list and not one value ───────────────────────────────────────────
 * `aud` identifies the OAuth client the token was minted FOR. One backend can
 * legitimately serve several — a web client and an Android one, or two Cloud
 * projects mid-migration — and each has its own id, so a single-value check
 * would reject perfectly good tokens from the app's own other front end.
 *
 * ── Why this does not weaken anything ──────────────────────────────────────
 * It is an ALLOW-LIST built only from environment variables. Nothing in a
 * request can add to it. A token minted for any client id NOT in this list is
 * still rejected, which is the whole point of the audience check: without it,
 * any website the user signs into with Google could replay its own token here
 * and be let in as them.
 *
 * ── The part an operator has to get right ──────────────────────────────────
 * Every id listed is a party trusted to mint credentials for this site. Adding
 * an OAuth client you do not control hands its owner the ability to sign in as
 * any of their users. GOOGLE_CLIENT_ID_ALT is opt-in and unset by default.
 */
export const googleAudiences = (): string[] => {
  const primary = String(config.google.client_id || '').trim();
  const alt = String(config.google.client_id_alt || '').trim();
  return Array.from(new Set([primary, alt].filter(Boolean)));
};

/**
 * Is Google sign-in switched on?
 *
 * GOOGLE_CLIENT_ID doubles as the feature flag: without it there is no audience
 * to verify against, so there is no safe way to accept a token. The route
 * answers a clean 503 and the client renders no button. GOOGLE_CLIENT_ID_ALT
 * alone is NOT enough — it is a supplement, and a deployment that set only the
 * "alt" variable is far more likely to be a mistake than an intention.
 */
export const isGoogleConfigured = (): boolean =>
  Boolean(String(config.google.client_id || '').trim());

// ── Startup diagnostic ──
// Runs once, when this module is first imported during route setup.
//
// The failure it warns about is genuinely hard to see: the browser mints its
// token against NEXT_PUBLIC_GOOGLE_CLIENT_ID, and if the server's list does not
// contain that id, EVERY sign-in fails with an identical, deliberately vague
// 401 — the same 401 a forged token gets. Two ids from different Cloud projects
// (the leading digits before the '-' are the project number) is the usual cause,
// so say so out loud at boot rather than leaving someone to guess.
(() => {
  const primary = String(config.google.client_id || '').trim();
  const alt = String(config.google.client_id_alt || '').trim();
  if (!primary || !alt || primary === alt) return;

  const projectOf = (id: string) => id.split('-')[0];
  if (projectOf(primary) !== projectOf(alt)) {
    // eslint-disable-next-line no-console
    console.warn(
      `⚠️  Google sign-in: GOOGLE_CLIENT_ID (project ${projectOf(primary)}) and ` +
        `GOOGLE_CLIENT_ID_ALT (project ${projectOf(alt)}) are from DIFFERENT Google Cloud ` +
        `projects. Both are accepted as token audiences, which means both projects are ` +
        `trusted to sign users into this site. Consolidate on one project and drop ` +
        `GOOGLE_CLIENT_ID_ALT once the client is confirmed to use only one.`,
    );
  }
})();

/**
 * Seam for tests. Production passes the real google-auth-library call; the unit
 * tests pass a stub, because a genuine token cannot be minted without
 * credentials and Google's signing keys rotate.
 */
// The base no-unused-vars rule cannot tell a function-TYPE parameter — named
// purely so the signature reads — from an unused binding. A TS function type
// declares no bindings at all, so there is nothing here to leave unused.
/* eslint-disable no-unused-vars */
export type IdTokenVerifier = (
  idToken: string,
  audience: string[],
) => Promise<TokenPayload | undefined>;
/* eslint-enable no-unused-vars */

// One client, built on first use. Constructing it at module load would run
// before dotenv in some import orders, and would also mean an unconfigured
// deployment pays for it at boot.
let cachedClient: OAuth2Client | null = null;

const realVerifier: IdTokenVerifier = async (idToken, audience) => {
  if (!cachedClient) cachedClient = new OAuth2Client(audience[0]);
  // Checks signature (against Google's rotating JWKS), issuer, audience and
  // expiry. Throws on any failure — it never returns a "failed" ticket.
  // `audience` may be an array: the library then requires `aud` to match ONE
  // of them, which is the allow-list semantics googleAudiences() describes.
  const ticket = await cachedClient.verifyIdToken({ idToken, audience });
  return ticket.getPayload();
};

/** Google's avatar URLs are https; anything else is not worth storing. */
const safeAvatar = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    return new URL(raw).protocol === 'https:' ? raw : '';
  } catch {
    return '';
  }
};

/**
 * `firstName` is `required: true` on the User schema, so it must never come out
 * empty. given_name is the normal case; the fallbacks cover accounts (some
 * Workspace ones) that only carry a display name, or none at all.
 */
const pickNames = (payload: TokenPayload, email: string) => {
  const given = String(payload.given_name || '').trim();
  const family = String(payload.family_name || '').trim();
  if (given) return { firstName: given, lastName: family };

  const full = String(payload.name || '').trim();
  if (full) {
    const [head, ...rest] = full.split(/\s+/);
    return { firstName: head, lastName: family || rest.join(' ') };
  }

  return { firstName: email.split('@')[0] || 'User', lastName: family };
};

/**
 * Turn an untrusted ID token into a proven identity, or throw.
 *
 * @param idToken    the `credential` string from Google Identity Services
 * @param verifier   injected in tests; defaults to the real library call
 * @param audiences  injected in tests; defaults to the configured allow-list
 */
export const verifyGoogleIdToken = async (
  idToken: unknown,
  verifier: IdTokenVerifier = realVerifier,
  audiences: string[] = googleAudiences(),
): Promise<GoogleIdentity> => {
  if (!audiences.length) {
    throw new GoogleAuthError(
      'not_configured',
      'Google sign-in is not configured on this server.',
      503,
    );
  }

  if (typeof idToken !== 'string' || !idToken.trim()) {
    throw new GoogleAuthError('missing_token', 'A Google ID token is required.', 400);
  }

  let payload: TokenPayload | undefined;
  try {
    payload = await verifier(idToken.trim(), audiences);
  } catch {
    // Bad signature, wrong audience, expired, malformed, unreachable JWKS —
    // the library does not distinguish and neither should the response. A
    // caller who learns WHY their forged token failed learns how to forge a
    // better one.
    throw new GoogleAuthError('invalid_token', 'Google sign-in could not be verified.', 401);
  }

  if (!payload) {
    throw new GoogleAuthError('invalid_token', 'Google sign-in could not be verified.', 401);
  }

  // ── Re-checks. See "Defence in depth" at the top of the file. ──
  if (!GOOGLE_ISSUERS.includes(String(payload.iss))) {
    throw new GoogleAuthError('invalid_token', 'Google sign-in could not be verified.', 401);
  }

  if (!audiences.includes(String(payload.aud))) {
    // A token minted for an application that is NOT on the allow-list.
    // Accepting these is the classic confused-deputy hole: any site the user
    // signs into with Google could replay its own token here and be let in.
    throw new GoogleAuthError('invalid_token', 'Google sign-in could not be verified.', 401);
  }

  if (
    typeof payload.exp === 'number' &&
    payload.exp + EXPIRY_GRACE_SECONDS <= Math.floor(Date.now() / 1000)
  ) {
    throw new GoogleAuthError('invalid_token', 'Google sign-in could not be verified.', 401);
  }

  const googleId = String(payload.sub || '').trim();
  if (!googleId) {
    throw new GoogleAuthError('invalid_token', 'Google sign-in could not be verified.', 401);
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    throw new GoogleAuthError(
      'email_missing',
      'Your Google account did not share an email address.',
      401,
    );
  }

  // The load-bearing check. `email_verified` is optional in the type and MUST
  // be strictly true — undefined, 'true' and 1 are all rejected.
  if (payload.email_verified !== true) {
    throw new GoogleAuthError(
      'email_unverified',
      'This Google account has not verified its email address. Verify it with Google, then try again.',
      401,
    );
  }

  const { firstName, lastName } = pickNames(payload, email);

  return {
    googleId,
    email,
    firstName,
    lastName,
    image: safeAvatar(payload.picture),
  };
};
