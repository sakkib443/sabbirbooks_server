import { isIP } from 'net';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * The visitor's own address, for rate limiting.
 *
 * Every browser request reaches this server through the shop's Next.js server
 * (next.config.ts proxies /api and /uploads so visitors never have to resolve
 * the sslip.io host). That proxy is the hop Express sees: req.ip is the Next
 * container's address, the SAME for every visitor in the country. So each
 * limiter below was one bucket shared by the whole site — thirty QR scans a
 * minute for everyone together, twenty guest orders per ten minutes, twenty
 * Google sign-ins per quarter hour. On a busy evening the thirty-first student
 * to scan a page got "Too many scans" for doing nothing wrong.
 *
 * The Next server knows who the visitor is (Traefik told it), and its proxy.ts
 * hands that on in CLIENT_IP_HEADER. It is believed only when BOTH hold:
 *
 *   • the request came from inside the server — a private or loopback hop,
 *     which is what our own Next container is. A stranger calling the API
 *     directly arrives with their public address as the hop, so a header they
 *     invent is ignored and they are limited as themselves;
 *   • the path is one proxy.ts actually stamps (TRUSTED_PATHS). On any other
 *     path the header would have passed through the proxy untouched — i.e. it
 *     would be whatever the visitor typed — so it is ignored there too.
 *
 * Anything else falls back to req.ip: never worse than before.
 */
export const CLIENT_IP_HEADER = 'x-mv-client-ip';

/**
 * Must match the matcher in the shop's src/proxy.ts exactly. Case-sensitive and
 * with no trailing slash, on purpose: Express would route "/api/Orders/" too,
 * but proxy.ts never stamps that spelling, so its header cannot be trusted.
 * A QR code is letters and digits only, so the scan path allows nothing else —
 * an encoded slash ("%2F") could otherwise slip past the matcher's one-segment
 * :code and arrive here still carrying the visitor's own header.
 */
const TRUSTED_PATHS = [
  /^\/api\/book-content\/scan\/[A-Za-z0-9]+$/,
  /^\/api\/orders$/,
  /^\/api\/book-coupons\/validate$/,
  /^\/api\/user\/google-signin$/,
];

const isInternalHop = (raw: string): boolean => {
  const ip = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
};

export const clientIp = (req: Request): string => {
  const hop = req.ip || req.socket?.remoteAddress || '';
  if (!isInternalHop(hop)) return hop;

  const path = (req.originalUrl || '').split('?')[0];
  if (!TRUSTED_PATHS.some((re) => re.test(path))) return hop;

  const raw = req.headers[CLIENT_IP_HEADER];
  const claimed = (Array.isArray(raw) ? raw[0] : raw || '').trim();
  return isIP(claimed) ? claimed : hop;
};

/**
 * A rate-limit key for the visitor. ipKeyGenerator groups an IPv6 visitor by
 * their /56, so one phone cannot walk a fresh address per request.
 */
export const clientIpKey = (req: Request): string => ipKeyGenerator(clientIp(req));
