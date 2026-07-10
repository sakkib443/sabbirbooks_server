/* eslint-disable no-console */
/**
 * Throwaway E2E test for AUTH + DEVICE-LIMIT (Phase 3).
 *
 * Boots an ISOLATED in-memory MongoDB (does NOT touch the real Atlas DB),
 * connects the real Express app, and drives the full flow via supertest:
 *   1. register a user
 *   2. login from device "d1"   (get tokens + deviceId)
 *   3. login from device "d2"
 *   4. login from device "d3"   → oldest (d1) session auto-evicted
 *   5. refresh with d1's token  → 401 (device was logged out)
 *   6. refresh with d2 / d3     → 200
 *   7. logout d2                → its session is gone
 *   + bonus: login by PHONE number
 *
 * Run:  npx ts-node src/__tests__/auth.e2e.ts   (or: npm run test:e2e)
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${msg}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  // Set env BEFORE importing the app so config + models + dbConnect bind to
  // the in-memory server (dotenv does not override already-set env vars).
  process.env.DATABASE_URL = uri;
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.DEVICE_LIMIT = '2';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  console.log(`🗄️  In-memory MongoDB ready: ${uri}\n`);

  const api = () => request(app);
  const cred = {
    firstName: 'Device',
    lastName: 'Tester',
    email: 'device.test@example.com',
    password: 'pass1234',
  };

  // ── 1. register ──
  const reg = await api().post('/api/auth/register').send(cred);
  console.log(`[1] POST /api/auth/register  -> ${reg.status}`);
  check(reg.status === 201, 'register returns 201');

  const login = (deviceId: string) =>
    api()
      .post('/api/auth/login')
      .set('x-device-id', deviceId)
      .send({ email: cred.email, password: cred.password });

  // ── 2. login d1 ──
  const l1 = await login('d1');
  console.log(`[2] login d1 -> ${l1.status} (deviceId=${l1.body?.data?.deviceId})`);
  check(l1.status === 200, 'login d1 returns 200');
  check(!!l1.body?.data?.refreshToken && !!l1.body?.data?.accessToken, 'login d1 returns access + refresh tokens');
  check(l1.body?.data?.deviceId === 'd1', 'login d1 echoes the x-device-id back');
  const d1Refresh = l1.body.data.refreshToken;
  await sleep(8);

  // ── 3. login d2 ──
  const l2 = await login('d2');
  console.log(`[3] login d2 -> ${l2.status}`);
  check(l2.status === 200, 'login d2 returns 200');
  const d2Refresh = l2.body.data.refreshToken;
  const d2Access = l2.body.data.accessToken;
  await sleep(8);

  // ── 4. login d3 → d1 should be evicted (oldest) ──
  const l3 = await login('d3');
  console.log(`[4] login d3 -> ${l3.status}`);
  check(l3.status === 200, 'login d3 returns 200');
  const d3Refresh = l3.body.data.refreshToken;
  const d3Access = l3.body.data.accessToken;

  const sess = await api().get('/api/auth/sessions').set('Authorization', `Bearer ${d3Access}`);
  const deviceIds = ((sess.body?.data as any[]) || []).map((s) => s.deviceId).sort();
  console.log(`    GET /api/auth/sessions -> ${sess.status}, active devices = ${JSON.stringify(deviceIds)}`);
  check(sess.status === 200, 'GET /sessions returns 200');
  check(deviceIds.length === 2, 'exactly 2 active sessions remain (device limit = 2)');
  check(!deviceIds.includes('d1'), 'd1 session was auto-evicted (oldest)');
  check(deviceIds.includes('d2') && deviceIds.includes('d3'), 'd2 and d3 sessions remain');

  // ── 5. refresh with d1 → 401 ──
  const r1 = await api().post('/api/auth/refresh-token').set('x-device-id', 'd1').send({ refreshToken: d1Refresh });
  console.log(`[5] refresh d1 -> ${r1.status} ("${r1.body?.message}")`);
  check(r1.status === 401, 'refresh d1 returns 401 (evicted device is logged out)');

  // ── 6. refresh with d2 / d3 → 200 ──
  const r2 = await api().post('/api/auth/refresh-token').set('x-device-id', 'd2').send({ refreshToken: d2Refresh });
  const r3 = await api().post('/api/auth/refresh-token').set('x-device-id', 'd3').send({ refreshToken: d3Refresh });
  console.log(`[6] refresh d2 -> ${r2.status}, refresh d3 -> ${r3.status}`);
  check(r2.status === 200 && !!r2.body?.data?.accessToken, 'refresh d2 returns 200 + new access token');
  check(r3.status === 200 && !!r3.body?.data?.accessToken, 'refresh d3 returns 200 + new access token');

  // ── 7. logout d2 → its session gone ──
  const lo = await api()
    .post('/api/auth/logout')
    .set('x-device-id', 'd2')
    .set('Authorization', `Bearer ${d2Access}`)
    .send();
  console.log(`[7] logout d2 -> ${lo.status}`);
  check(lo.status === 200, 'logout d2 returns 200');
  const r2b = await api().post('/api/auth/refresh-token').set('x-device-id', 'd2').send({ refreshToken: d2Refresh });
  console.log(`    refresh d2 after logout -> ${r2b.status}`);
  check(r2b.status === 401, 'refresh d2 after logout returns 401 (session removed)');

  // ── bonus: login by PHONE number ──
  const phoneUser = {
    firstName: 'Phone',
    lastName: 'Login',
    email: 'phone.login@example.com',
    phoneNumber: '01711111111',
    password: 'pass1234',
  };
  await api().post('/api/auth/register').send(phoneUser);
  const phoneLogin = await api()
    .post('/api/auth/login')
    .set('x-device-id', 'pd1')
    .send({ phone: '01711111111', password: 'pass1234' });
  console.log(`[8] login by PHONE -> ${phoneLogin.status}`);
  check(phoneLogin.status === 200, 'login by phone number works');

  console.log(`\n──────── RESULT: ${passed} passed, ${failed} failed ────────`);

  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('TEST CRASHED:', e);
  process.exit(1);
});
