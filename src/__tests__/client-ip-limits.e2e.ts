/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Rate limits count each VISITOR, not the whole site (isolated in-memory
 * MongoDB, real Express app via supertest; never the live DB).
 *
 * In production every browser request reaches the API through the shop's own
 * Next.js server, so req.ip was that server — one address for every visitor —
 * and each limiter was a single bucket for the whole country: thirty QR scans a
 * minute between all readers. Proven on the live site by a request from another
 * network landing in the same bucket as ours.
 *
 * supertest connects from 127.0.0.1 and app.ts trusts one proxy hop, so the
 * X-Forwarded-For sent here plays the part of Traefik naming the hop:
 *   - a private address (10.0.1.7) = our own Next container
 *   - a public address = a stranger calling the API directly
 *
 * What has to hold:
 *   - two visitors through the proxy get two allowances
 *   - a signed-in reader is counted by account, so a classroom behind one
 *     address does not share one allowance
 *   - a stranger cannot pick their own bucket by inventing the header
 *   - the header counts only on the paths the shop's proxy.ts stamps
 *   - guest orders and coupon checks are per visitor too
 *
 * Run:  npx ts-node --transpile-only src/__tests__/client-ip-limits.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
  }
}

const NEXT_HOP = '10.0.1.7';
const remaining = (res: request.Response) => Number(res.headers['ratelimit-remaining']);

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
  process.env.ORDER_CREATE_LIMIT = '2';
  process.env.COUPON_PREVIEW_LIMIT = '2';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  const { clientIp, CLIENT_IP_HEADER } = await import('../app/utils/clientIp');
  await dbConnect();

  const viaShop = (path: string, visitor: string) =>
    request(app).get(path).set('X-Forwarded-For', NEXT_HOP).set(CLIENT_IP_HEADER, visitor);

  console.log('\n— QR scans through the shop: one allowance per visitor');
  {
    const a1 = await viaShop('/api/book-content/scan/AAAA0001', '198.51.100.1');
    check(a1.status === 404, 'an unknown code still answers 404', a1.status);
    check(remaining(a1) === 119, 'visitor A starts with a fresh allowance of 120', remaining(a1));
    const b1 = await viaShop('/api/book-content/scan/AAAA0002', '198.51.100.2');
    check(remaining(b1) === 119, 'visitor B is NOT charged for A (was one shared bucket)', remaining(b1));
    const a2 = await viaShop('/api/book-content/scan/AAAA0003', '198.51.100.1');
    check(remaining(a2) === 118, 'visitor A again: same bucket, one less', remaining(a2));
  }

  console.log('\n— Signed-in readers are counted by account');
  {
    const tokenFor = (id: string) =>
      jwt.sign({ _id: id, role: 'student' }, 'test_access_secret', { expiresIn: '1h' });
    const sameAddress = '198.51.100.50'; // a hostel Wi-Fi
    const r1 = await viaShop('/api/book-content/scan/BBBB0001', sameAddress)
      .set('Authorization', `Bearer ${tokenFor(new mongoose.Types.ObjectId().toString())}`);
    const r2 = await viaShop('/api/book-content/scan/BBBB0002', sameAddress)
      .set('Authorization', `Bearer ${tokenFor(new mongoose.Types.ObjectId().toString())}`);
    check(Number(r1.headers['ratelimit-limit']) === 60, 'a reader gets 60 a minute', r1.headers['ratelimit-limit']);
    check(remaining(r1) === 59 && remaining(r2) === 59, 'two readers on one Wi-Fi do not share', [remaining(r1), remaining(r2)]);
    const anon = await viaShop('/api/book-content/scan/BBBB0003', sameAddress);
    check(remaining(anon) === 119, 'a stranger on that Wi-Fi is not charged for the readers', remaining(anon));
    const forged = await viaShop('/api/book-content/scan/BBBB0004', sameAddress).set('Authorization', 'Bearer not-a-token');
    check(remaining(forged) === 118, 'a token that does not verify is counted as a stranger', remaining(forged));
  }

  console.log('\n— A stranger calling the API directly cannot choose a bucket');
  {
    const direct = (visitorClaim: string) =>
      request(app)
        .get('/api/book-content/scan/CCCC0001')
        .set('X-Forwarded-For', '203.0.113.9')
        .set(CLIENT_IP_HEADER, visitorClaim);
    const d1 = await direct('192.0.2.1');
    const d2 = await direct('192.0.2.2');
    const d3 = await direct('192.0.2.3');
    check(
      remaining(d1) === 119 && remaining(d2) === 118 && remaining(d3) === 117,
      'a new made-up header each time still drains ONE bucket (their own address)',
      [remaining(d1), remaining(d2), remaining(d3)]
    );
  }

  console.log('\n— Which requests the header is believed on');
  {
    const fake = (ip: string, url: string, header?: string): any => ({
      ip,
      socket: { remoteAddress: ip },
      originalUrl: url,
      headers: header === undefined ? {} : { [CLIENT_IP_HEADER]: header },
    });
    check(clientIp(fake('10.0.1.7', '/api/orders', '198.51.100.9')) === '198.51.100.9', 'from our proxy on /api/orders');
    check(clientIp(fake('::ffff:172.18.0.4', '/api/book-content/scan/X1Y2Z3W4?x=1', '198.51.100.9')) === '198.51.100.9', 'IPv4-mapped docker hop, query string ignored');
    check(clientIp(fake('192.168.0.3', '/api/book-coupons/validate', '2001:db8::1')) === '2001:db8::1', 'an IPv6 visitor');
    check(clientIp(fake('127.0.0.1', '/api/user/google-signin', '198.51.100.9')) === '198.51.100.9', 'loopback hop on google sign-in');
    check(clientIp(fake('10.0.1.7', '/api/orders/my', '198.51.100.9')) === '10.0.1.7', 'NOT on a path proxy.ts does not stamp');
    check(clientIp(fake('10.0.1.7', '/API/orders', '198.51.100.9')) === '10.0.1.7', 'NOT on an odd spelling proxy.ts never sees');
    check(clientIp(fake('10.0.1.7', '/api/orders/', '198.51.100.9')) === '10.0.1.7', 'NOT with a trailing slash');
    // The rewrite forwards the rest of the path as typed; proxy.ts only stamps
    // the exact spelling, so "/api/Orders" arrives still carrying a made-up value.
    check(clientIp(fake('10.0.1.7', '/api/Orders', '6.6.6.6')) === '10.0.1.7', 'NOT on /api/Orders (proxy.ts did not stamp it)');
    check(clientIp(fake('10.0.1.7', '/api/book-content/scan/AB%2FCD', '6.6.6.6')) === '10.0.1.7', 'NOT on a scan code with an encoded slash');
    check(clientIp(fake('10.0.1.7', '/api/book-content/scan/AB2C3D4E', '198.51.100.9')) === '198.51.100.9', 'a real QR code path');
    check(clientIp(fake('10.0.1.7', '/api/orders', 'not-an-ip')) === '10.0.1.7', 'NOT when the header is not an address');
    check(clientIp(fake('10.0.1.7', '/api/orders')) === '10.0.1.7', 'no header: the hop, as before');
    check(clientIp(fake('203.0.113.9', '/api/orders', '198.51.100.9')) === '203.0.113.9', 'NOT from a public hop');
    check(clientIp(fake('172.32.0.1', '/api/orders', '198.51.100.9')) === '172.32.0.1', '172.32/16 is public, not docker');
  }

  console.log('\n— Guest orders: per visitor (limit set to 2 for the test)');
  {
    const order = (visitor: string) =>
      request(app).post('/api/orders').set('X-Forwarded-For', NEXT_HOP).set(CLIENT_IP_HEADER, visitor).send({});
    const a = [await order('198.51.100.70'), await order('198.51.100.70'), await order('198.51.100.70')];
    check(a[0].status !== 429 && a[1].status !== 429, 'visitor A: first two pass the limiter', a.map((r) => r.status));
    check(a[2].status === 429, 'visitor A: the third is limited', a[2].status);
    const b = await order('198.51.100.71');
    check(b.status !== 429, 'visitor B can still order (was blocked with everyone)', b.status);
  }

  console.log('\n— Coupon checks: per visitor (limit set to 2 for the test)');
  {
    const tryCode = (visitor: string) =>
      request(app)
        .post('/api/book-coupons/validate')
        .set('X-Forwarded-For', NEXT_HOP)
        .set(CLIENT_IP_HEADER, visitor)
        .send({ code: 'NOPE' });
    await tryCode('198.51.100.80');
    await tryCode('198.51.100.80');
    const third = await tryCode('198.51.100.80');
    check(third.status === 429, 'visitor A: third try limited', third.status);
    const other = await tryCode('198.51.100.81');
    check(other.status !== 429, 'visitor B unaffected', other.status);
  }

  await mongoose.disconnect();
  await mongod.stop();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
