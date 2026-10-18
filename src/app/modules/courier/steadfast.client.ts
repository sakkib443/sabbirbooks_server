/**
 * Steadfast Courier (packzy) API — the few calls the shop uses.
 *
 * Every request carries the merchant's Api-Key and Secret-Key headers. Both
 * come from the environment (STEADFAST_API_KEY / STEADFAST_SECRET_KEY) and
 * nowhere else: they are never stored in the database, never sent to the
 * browser, and the Settings endpoint — which is public — cannot leak them.
 *
 *   POST /create_order/bulk-order   up to 500 parcels, { data: JSON string }
 *   GET  /status_by_cid/:id         { status, delivery_status }
 *   GET  /get_balance               { status, current_balance }
 *   GET  /payments                  the payouts Steadfast has made
 *   GET  /payments/:id              one payout, with its consignments
 */

const BASE_URL = (process.env.STEADFAST_BASE_URL || 'https://portal.packzy.com/api/v1').replace(/\/+$/, '');

export const steadfastConfigured = (): boolean =>
  Boolean(process.env.STEADFAST_API_KEY && process.env.STEADFAST_SECRET_KEY);

/** The token Steadfast sends with its webhook calls (set the same in its panel). */
export const steadfastWebhookToken = (): string => String(process.env.STEADFAST_WEBHOOK_TOKEN || '');

export class SteadfastError extends Error {
  constructor(message: string, public httpStatus?: number) {
    super(message);
  }
}

const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
  if (!steadfastConfigured()) throw new SteadfastError('Steadfast is not set up (API key missing)');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Api-Key': String(process.env.STEADFAST_API_KEY),
        'Secret-Key': String(process.env.STEADFAST_SECRET_KEY),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON — reported below */
    }
    if (!res.ok || json === null) {
      const msg = json?.message || json?.error || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new SteadfastError(`Steadfast: ${msg}`, res.status);
    }
    return json as T;
  } catch (e: any) {
    if (e instanceof SteadfastError) throw e;
    throw new SteadfastError(e?.name === 'AbortError' ? 'Steadfast did not answer in time' : `Steadfast: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
};

export interface SteadfastParcel {
  invoice: string;
  recipient_name: string;
  recipient_phone: string;
  alternative_phone?: string;
  recipient_address: string;
  cod_amount: number;
  note?: string;
  item_description?: string;
  total_lot?: number;
  delivery_type?: number;
}

export interface SteadfastBulkResult {
  invoice: string;
  consignment_id: number | null;
  tracking_code: string | null;
  status: 'success' | 'error' | string;
  /** Present on some error rows. */
  error?: string;
  message?: string;
}

/** Up to 500 parcels in one request. */
export const createBulk = async (parcels: SteadfastParcel[]): Promise<SteadfastBulkResult[]> => {
  const res: any = await call('POST', '/create_order/bulk-order', { data: JSON.stringify(parcels) });
  // The answer is the array itself, or wrapped in { data } by some versions.
  const rows = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : null;
  if (!rows) throw new SteadfastError(`Steadfast: unexpected bulk answer ${JSON.stringify(res).slice(0, 200)}`);
  return rows;
};

export const statusByConsignment = async (consignmentId: string): Promise<string> => {
  const res: any = await call('GET', `/status_by_cid/${encodeURIComponent(consignmentId)}`);
  return String(res?.delivery_status || '');
};

export const getBalance = async (): Promise<number> => {
  const res: any = await call('GET', '/get_balance');
  return Number(res?.current_balance ?? res?.balance ?? 0);
};

export interface SteadfastPaymentConsignment {
  consignment_id: number | string;
  invoice: string;
  tracking_code?: string;
  cod_amount: number;
  delivery_charge: number;
  status?: string;
}

export interface SteadfastPayment {
  id: number | string;
  amount: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  consignments?: SteadfastPaymentConsignment[];
}

const unwrapList = (res: any): any[] =>
  Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.data?.data) ? res.data.data : [];

export const listPayments = async (): Promise<SteadfastPayment[]> => unwrapList(await call('GET', '/payments'));

export const getPayment = async (id: string): Promise<SteadfastPayment> => {
  const res: any = await call('GET', `/payments/${encodeURIComponent(id)}`);
  const p = res?.data && !Array.isArray(res.data) ? res.data : res;
  return { ...p, consignments: unwrapList(p?.consignments ?? res?.consignments) };
};

/** The parcel's public tracking page — what the buyer's "shipped" SMS links to. */
/**
 * The link the buyer is sent: the shop's own tracking page (frontend /t/CODE),
 * not Steadfast's. Steadfast's public /t/ links now take a long token that the
 * API does not hand out, so a link built from the API's tracking code opened
 * "This link is not available". Our page looks the parcel up by that code and
 * asks Steadfast itself. PUBLIC_SITE_URL overrides the site address.
 */
export const publicSiteUrl = (): string => {
  const env = String(process.env.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const client = String(process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\//.test(client) && !/sslip\.io|localhost/.test(client) ? client : 'https://magicviva.com';
};
export const trackingPage = (trackingCode: string) => `${publicSiteUrl()}/t/${encodeURIComponent(trackingCode)}`;

