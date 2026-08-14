// ─── Gateway configuration — the single source of truth ─────────────────────
//
// Both payment services used to answer "are we in demo mode?" on their own, with
// a one-key test (`!config.bkash.app_key`). That is not enough to decide whether
// a LIVE call can succeed: bKash needs five credentials, and having only the
// app_key set flipped the service out of demo and straight into a real API call
// with `undefined` in the auth headers — a 401 at the worst possible moment, in
// front of a paying buyer.
//
// So configuration is all-or-nothing here: a gateway counts as configured only
// when every credential its live calls need is present. A half-filled .env keeps
// the gateway OFF (demo) and logs once at boot, which fails loudly at deploy time
// instead of silently at checkout time.
//
// The client reads the same answer over GET /api/payment/gateways, so the button
// a buyer sees and the code path the server takes can never disagree.

import config from '../../config';

export type GatewayId = 'bkash' | 'sslcommerz';

export interface GatewayState {
  /** Every required credential is present → live API calls are attempted. */
  configured: boolean;
  /** Live (real money) vs sandbox (test money). Meaningless when !configured. */
  live: boolean;
  /** Credentials that are required but blank. Never sent to the client. */
  missing: string[];
}

// ── Which env vars each gateway cannot work without ─────────────────────────
const BKASH_REQUIRED: { env: string; value?: string }[] = [
  { env: 'BKASH_APP_KEY', value: config.bkash.app_key },
  { env: 'BKASH_APP_SECRET', value: config.bkash.app_secret },
  { env: 'BKASH_USERNAME', value: config.bkash.username },
  { env: 'BKASH_PASSWORD', value: config.bkash.password },
];

const SSL_REQUIRED: { env: string; value?: string }[] = [
  { env: 'SSLCOMMERZ_STORE_ID', value: config.sslcommerz.store_id },
  { env: 'SSLCOMMERZ_STORE_PASS', value: config.sslcommerz.store_pass },
];

// A credential that is blank, whitespace, or the literal placeholder `demo`
// counts as absent — `demo` is what the old one-key check treated as "not real",
// and .env.example ships the keys empty.
const isBlank = (v?: string): boolean => {
  const s = (v ?? '').trim();
  return s === '' || s.toLowerCase() === 'demo';
};

const evaluate = (required: { env: string; value?: string }[], live: boolean): GatewayState => {
  const missing = required.filter((r) => isBlank(r.value)).map((r) => r.env);
  return { configured: missing.length === 0, live, missing };
};

// ── bKash ───────────────────────────────────────────────────────────────────
// BKASH_IS_LIVE picks the host. It used to be implicit and wrong: the grant-token
// URL came from env (so a merchant could point it at sandbox) while create/execute/
// query were hardcoded to the LIVE host — tokens minted in sandbox, payments sent
// to production. One flag now drives all four.
export const bkashIsLive = (): boolean => process.env.BKASH_IS_LIVE === 'true';

export const bkashHost = (): string =>
  bkashIsLive() ? 'https://tokenized.pay.bka.sh' : 'https://tokenized.sandbox.bka.sh';

const BKASH_API = '/v1.2.0-beta/tokenized/checkout';

export const bkashUrls = () => {
  const host = bkashHost();
  return {
    // An explicit BKASH_GRANT_TOKEN_URL still wins, for merchants who were given
    // a non-standard endpoint.
    grantToken: config.bkash.grant_token_url?.trim() || `${host}${BKASH_API}/token/grant`,
    create: `${host}${BKASH_API}/create`,
    execute: `${host}${BKASH_API}/execute`,
    query: `${host}${BKASH_API}/payment/status`,
  };
};

export const bkashState = (): GatewayState => evaluate(BKASH_REQUIRED, bkashIsLive());

// ── SSLCommerz ──────────────────────────────────────────────────────────────
export const sslcommerzState = (): GatewayState =>
  evaluate(SSL_REQUIRED, config.sslcommerz.is_live === true);

export const sslcommerzHost = (): string =>
  config.sslcommerz.is_live ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';

// ── Where the gateway should send the buyer / the server back ───────────────
//
// SSLCommerz and bKash both need PUBLICLY reachable URLs, and they need to reach
// the SERVER, not the browser app: SSLCommerz delivers its result as a form POST
// (a Next.js page cannot receive one) and bKash's capture step must run even if
// the buyer closes the tab. So callbacks land on the API and the API redirects
// the browser onward.
//
// `config` has no server_url field and config/index.ts belongs to another agent,
// so SERVER_URL is read here directly. Documented in .env.example.
export const serverUrl = (): string =>
  (process.env.SERVER_URL || `http://localhost:${config.port}`).replace(/\/+$/, '');

export const clientUrl = (): string => (config.client_url || '').replace(/\/+$/, '');

/** Where the buyer lands after any gateway round-trip. */
export const returnUrl = (
  status: 'success' | 'failed' | 'cancelled',
  params: Record<string, string | undefined> = {}
): string => {
  const qs = new URLSearchParams({ status });
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `${clientUrl()}/payment/return?${qs.toString()}`;
};

// ── Public status, for GET /api/payment/gateways ────────────────────────────
// `missing` is deliberately dropped: it names env vars, which is deploy
// information, not something to hand to every visitor.
export const publicGatewayStatus = () => {
  const bkash = bkashState();
  const ssl = sslcommerzState();
  return {
    bkash: { configured: bkash.configured, live: bkash.live },
    sslcommerz: { configured: ssl.configured, live: ssl.live },
    /** True when a buyer can be sent to a hosted checkout at all. */
    anyConfigured: bkash.configured || ssl.configured,
  };
};

// ── Boot-time warning for a half-filled .env ────────────────────────────────
let warned = false;
export const warnIfPartiallyConfigured = (): void => {
  if (warned) return;
  warned = true;
  for (const [name, state, total] of [
    ['bKash', bkashState(), BKASH_REQUIRED.length],
    ['SSLCommerz', sslcommerzState(), SSL_REQUIRED.length],
  ] as const) {
    // Some keys set but not all → the merchant thinks it is on and it is not.
    if (!state.configured && state.missing.length < total) {
      console.warn(
        `[payment] ${name} is PARTIALLY configured — staying in demo mode. Missing: ${state.missing.join(', ')}`
      );
    }
  }
};
