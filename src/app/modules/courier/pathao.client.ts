/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pathao Courier merchant API (1 Nov 2026) — the second courier, beside
 * Steadfast. The shop picks which one on the send page.
 *
 * Everything comes from the environment, never the database or the browser:
 *   PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET   Developer API page in the panel
 *   PATHAO_USERNAME, PATHAO_PASSWORD         the merchant panel login
 *   PATHAO_STORE_ID                          the pickup store (Stores page)
 *   PATHAO_BASE_URL                          optional; live by default
 *   PATHAO_WEBHOOK_SECRET                    optional; the webhook secret set in the panel
 *
 *   POST /aladdin/api/v1/issue-token           OAuth2 password grant → access_token
 *   POST /aladdin/api/v1/orders                one parcel → consignment_id
 *   GET  /aladdin/api/v1/orders/:id/info       its status
 *   GET  /aladdin/api/v1/city-list, /cities/:id/zone-list   only if Pathao
 *        insists on city/zone for an address (see resolveCityZone)
 */

const BASE_URL = (process.env.PATHAO_BASE_URL || 'https://api-hermes.pathao.com').replace(/\/+$/, '');

export const pathaoConfigured = (): boolean =>
  Boolean(
    process.env.PATHAO_CLIENT_ID &&
      process.env.PATHAO_CLIENT_SECRET &&
      process.env.PATHAO_USERNAME &&
      process.env.PATHAO_PASSWORD &&
      process.env.PATHAO_STORE_ID
  );

/** The secret Pathao sends with its webhook calls (X-PATHAO-Signature). */
export const pathaoWebhookSecret = (): string => String(process.env.PATHAO_WEBHOOK_SECRET || '');

export class PathaoError extends Error {
  constructor(message: string, public httpStatus?: number, public body?: any) {
    super(message);
  }
}

// ─── Token ────────────────────────────────────────────────────

let token: { value: string; until: number } | null = null;

const raw = async (method: 'GET' | 'POST', path: string, body?: unknown, auth?: string): Promise<any> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
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
      // Pathao's validation errors come as { message, errors: { field: [..] } }.
      const errs = json?.errors && typeof json.errors === 'object'
        ? Object.values(json.errors).flat().filter(Boolean).join('; ')
        : '';
      const msg = errs || json?.message || json?.error || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new PathaoError(`Pathao: ${msg}`, res.status, json);
    }
    return json;
  } catch (e: any) {
    if (e instanceof PathaoError) throw e;
    throw new PathaoError(e?.name === 'AbortError' ? 'Pathao did not answer in time' : `Pathao: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
};

const accessToken = async (): Promise<string> => {
  if (token && Date.now() < token.until) return token.value;
  const res = await raw('POST', '/aladdin/api/v1/issue-token', {
    client_id: String(process.env.PATHAO_CLIENT_ID),
    client_secret: String(process.env.PATHAO_CLIENT_SECRET),
    grant_type: 'password',
    username: String(process.env.PATHAO_USERNAME),
    password: String(process.env.PATHAO_PASSWORD),
  });
  const value = String(res?.access_token || '');
  if (!value) throw new PathaoError('Pathao: login gave no access token (check the client id/secret and the panel login)');
  // Kept a little less than Pathao says (default a day) so it never expires mid-request.
  const life = Math.max(Number(res?.expires_in) || 86_400, 600);
  token = { value, until: Date.now() + (life - 300) * 1000 };
  return value;
};

/** A call with the merchant token; a 401 logs in again once. */
const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> => {
  if (!pathaoConfigured()) throw new PathaoError('Pathao is not set up (credentials missing)');
  try {
    return await raw(method, path, body, await accessToken());
  } catch (e: any) {
    if (e instanceof PathaoError && e.httpStatus === 401) {
      token = null;
      return raw(method, path, body, await accessToken());
    }
    throw e;
  }
};

/** Does the login work? (For the courier page's connection badge; a held token counts.) */
export const pathaoPing = async (): Promise<void> => {
  if (!pathaoConfigured()) throw new PathaoError('Pathao is not set up (credentials missing)');
  await accessToken();
};

// ─── City / zone (only when Pathao asks for them) ────────────

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
let cities: { id: number; name: string }[] | null = null;
const zonesByCity = new Map<number, { id: number; name: string }[]>();

const listOf = (res: any): any[] => (Array.isArray(res?.data?.data) ? res.data.data : Array.isArray(res?.data) ? res.data : []);

/**
 * Pathao's city and zone ids for an address, matched by name: the district is
 * the city ("Dhaka", "Chattogram"/"Chittagong"…), the upazila or area the zone.
 * Used only when an order is refused for want of them.
 */
export const resolveCityZone = async (district?: string, upazila?: string): Promise<{ city?: number; zone?: number }> => {
  if (!cities) {
    cities = listOf(await call('GET', '/aladdin/api/v1/city-list')).map((c: any) => ({ id: Number(c.city_id), name: String(c.city_name || '') }));
  }
  const alias: Record<string, string> = { chattogram: 'chittagong', chittagong: 'chattogram', cumilla: 'comilla', comilla: 'cumilla', barishal: 'barisal', barisal: 'barishal', jashore: 'jessore', jessore: 'jashore', bogura: 'bogra', bogra: 'bogura' };
  const d = norm(district || '');
  const city = cities.find((c) => norm(c.name) === d) || cities.find((c) => norm(c.name) === alias[d]) || cities.find((c) => d && norm(c.name).includes(d));
  if (!city) return {};
  if (!zonesByCity.has(city.id)) {
    zonesByCity.set(city.id, listOf(await call('GET', `/aladdin/api/v1/cities/${city.id}/zone-list`)).map((z: any) => ({ id: Number(z.zone_id), name: String(z.zone_name || '') })));
  }
  const zones = zonesByCity.get(city.id) || [];
  const u = norm(upazila || '');
  const zone = (u && (zones.find((z) => norm(z.name) === u) || zones.find((z) => norm(z.name).includes(u) || u.includes(norm(z.name))))) || zones.find((z) => norm(z.name).includes('sadar')) || zones[0];
  return { city: city.id, zone: zone?.id };
};

// ─── Orders ──────────────────────────────────────────────────

export interface PathaoParcel {
  merchant_order_id: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_secondary_phone?: string;
  recipient_address: string;
  amount_to_collect: number;
  item_quantity: number;
  item_weight: number;
  item_description?: string;
  special_instruction?: string;
  /** Only sent when Pathao insists (see createOrder). */
  district?: string;
  upazila?: string;
}

export interface PathaoCreated {
  consignmentId: string;
  status: string;
  deliveryFee: number | null;
}

/**
 * Book one parcel. Sent without city/zone first (Pathao reads the address);
 * if Pathao refuses for want of them, they are looked up by district and
 * upazila and the parcel is sent once more.
 */
export const createOrder = async (p: PathaoParcel): Promise<PathaoCreated> => {
  const { district, upazila, ...fields } = p;
  const body: Record<string, unknown> = {
    store_id: Number(process.env.PATHAO_STORE_ID),
    delivery_type: 48, // normal delivery
    item_type: 2, // parcel
    ...fields,
  };
  let res: any;
  try {
    res = await call('POST', '/aladdin/api/v1/orders', body);
  } catch (e: any) {
    const wantsArea = e instanceof PathaoError && /recipient_(city|zone)|city|zone/i.test(`${e.message} ${JSON.stringify(e.body?.errors || {})}`);
    if (!wantsArea) throw e;
    const { city, zone } = await resolveCityZone(district, upazila);
    if (!city || !zone) throw new PathaoError(`Pathao needs the city/zone and "${district || '?'} / ${upazila || '?'}" did not match its list`);
    res = await call('POST', '/aladdin/api/v1/orders', { ...body, recipient_city: city, recipient_zone: zone });
  }
  const d = res?.data || {};
  const consignmentId = String(d.consignment_id || '');
  if (!consignmentId) throw new PathaoError(`Pathao: unexpected answer ${JSON.stringify(res).slice(0, 200)}`);
  return {
    consignmentId,
    status: String(d.order_status || 'Pending'),
    deliveryFee: d.delivery_fee != null ? Number(d.delivery_fee) : null,
  };
};

/** The parcel's status as Pathao words it ("Pending", "In Transit", "Delivered"…). */
export const pathaoStatus = async (consignmentId: string): Promise<string> => {
  const res = await call('GET', `/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`);
  const d = res?.data || {};
  return String(d.order_status_slug || d.order_status || '');
};

/**
 * Pathao's status (or webhook event) in the words the rest of the courier
 * code — and its four groups — already use (Steadfast's): delivered,
 * partial_delivered, cancelled (= back to the shop), hold, in_review, pending.
 * '' for an event that says nothing about where the parcel is (a payout).
 */
export const mapPathaoStatus = (raw: string): string => {
  const s = String(raw || '').toLowerCase().replace(/^order\./, '').replace(/[\s_]+/g, '-');
  if (!s) return '';
  if (s.includes('partial')) return 'partial_delivered';
  if (s.includes('fail') || s.includes('hold')) return 'hold';
  if (s.includes('return') || s.includes('cancel')) return 'cancelled';
  if (s.includes('deliver') && !s.includes('assign')) return 'delivered';
  // A payout, or an edit to the parcel: nothing about where it is.
  if (s === 'paid' || s.includes('invoice') || s === 'updated' || s === 'store-created' || s === 'store-updated') return '';
  if (s === 'created' || s === 'pending' || s.includes('pickup-request')) return 'in_review';
  return 'pending';
};
