/* eslint-disable no-console */
/**
 * Staff device approval, device removal and the Super Admin's "view as".
 *
 *   • admin/manager from a new device → 403, a pending request, Super Admins
 *     notified; after approval the same device signs in.
 *   • a rejected device stays refused; the Super Admin signs in anywhere.
 *   • removing a device kills its access token on the very next request.
 *   • x-view-as makes a Super Admin request behave as admin / manager, and is
 *     ignored on anyone else's token.
 *   • students are untouched.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`, detail ?? '');
  }
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { User } = await import('../app/modules/user/user.model');
  const { Notification } = await import('../app/modules/notification/notification.model');
  const { StaffDevice } = await import('../app/modules/security/staffDevice.model');
  const { Session } = await import('../app/modules/session/session.model');
  const { SecurityService } = await import('../app/modules/security/security.service');
  const api = () => request(app);

  const make = async (email: string, role?: string) => {
    await api().post('/api/auth/register').send({ firstName: 'T', lastName: email[0], email, password: 'pass1234', whatsappNumber: '01712345678' });
    if (role) await User.updateOne({ email }, { role });
  };
  const login = (email: string, device: string) =>
    api().post('/api/auth/login').set('x-device-id', device).set('user-agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0').send({ email, password: 'pass1234' });

  await make('owner@test.com', 'superAdmin');
  await make('admin@test.com', 'admin');
  await make('manager@test.com', 'manager');
  await make('student@test.com');

  console.log('── Super Admin and students sign in anywhere ──');
  const sLogin = await login('owner@test.com', 'owner-laptop');
  check(sLogin.status === 200, 'Super Admin signs in from a new device', sLogin.status);
  const S = { Authorization: `Bearer ${sLogin.body?.data?.accessToken}` };
  check((await login('student@test.com', 'stu-phone')).status === 200, 'student signs in from a new device');
  const owner: any = await User.findOne({ email: 'owner@test.com' }).lean();
  check((await Notification.countDocuments({ userId: owner._id })) === 0, 'Super Admin own login raises no alert');

  console.log('── Admin from a new device waits ──');
  const a1 = await login('admin@test.com', 'admin-pc');
  check(a1.status === 403 && a1.body?.code === 'DEVICE_APPROVAL_REQUIRED', 'admin new device → 403 DEVICE_APPROVAL_REQUIRED', a1.body);
  check(!a1.body?.data?.accessToken, 'no token handed out');
  check((await Session.countDocuments({ deviceId: 'admin-pc' })) === 0, 'no session made');
  check((await Notification.countDocuments({ userId: owner._id })) === 1, 'Super Admin notified once');
  await login('admin@test.com', 'admin-pc');
  check((await Notification.countDocuments({ userId: owner._id })) === 1, 'pressing again does not flood the bell');
  check((await login('admin@test.com', 'wrong')).status === 403, 'every new device waits');
  const badPw = await api().post('/api/auth/login').set('x-device-id', 'x').send({ email: 'admin@test.com', password: 'nope' });
  check(badPw.status === 401, 'wrong password is still a plain 401 (no request made)', badPw.status);
  check((await StaffDevice.countDocuments({ deviceId: 'x' })) === 0, 'wrong password leaves no request');

  console.log('── Security screen ──');
  const ov = (await api().get('/api/security/overview').set(S)).body?.data;
  const req = ov?.requests?.find((r: any) => r.email === 'admin@test.com' && r.deviceId === 'admin-pc');
  check(Boolean(req) && /Chrome on Windows/.test(req.device), 'request listed with its device', ov?.requests);
  const aLoginAttemptToken = await login('student@test.com', 's2');
  const st = { Authorization: `Bearer ${aLoginAttemptToken.body?.data?.accessToken}` };
  check((await api().get('/api/security/overview').set(st)).status === 403, 'a student cannot open the Security screen');

  console.log('── Approve → the device signs in ──');
  check((await api().post(`/api/security/requests/${req._id}/approve`).set(S)).status === 200, 'Super Admin approves');
  const a2 = await login('admin@test.com', 'admin-pc');
  check(a2.status === 200, 'approved device signs in', a2.status);
  const A = { Authorization: `Bearer ${a2.body?.data?.accessToken}` };
  check((await api().get('/api/orders').set(A)).status === 200, 'admin token works');
  check((await api().get('/api/security/overview').set(A)).status === 403, 'admin cannot open the Security screen');
  const loginAlerts = await Notification.countDocuments({ userId: owner._id, title: /Staff login/ });
  check(loginAlerts === 1, 'Super Admin told about the admin login', loginAlerts);

  console.log('── Reject ──');
  const m1 = await login('manager@test.com', 'mgr-phone');
  check(m1.status === 403, 'manager new device waits');
  const mreq = (await api().get('/api/security/overview').set(S)).body?.data?.requests?.find((r: any) => r.email === 'manager@test.com');
  await api().post(`/api/security/requests/${mreq._id}/reject`).set(S);
  const m2 = await login('manager@test.com', 'mgr-phone');
  check(m2.status === 403 && /বাতিল/.test(m2.body?.message), 'rejected device stays refused', m2.body);

  console.log('── Remove a device → signed out at once ──');
  const adminDoc: any = await User.findOne({ email: 'admin@test.com' }).lean();
  const ov2 = (await api().get('/api/security/overview').set(S)).body?.data;
  const adminRow = ov2?.users?.find((u: any) => u.email === 'admin@test.com');
  check(adminRow?.sessions?.length === 1, 'admin shows 1 signed-in device', adminRow?.sessions);
  const rm = await api().post(`/api/security/users/${adminDoc._id}/devices/remove`).set(S).send({ deviceId: 'admin-pc' });
  check(rm.status === 200 && rm.body?.data?.removed === 1, 'Super Admin removes it', rm.body);
  check((await api().get('/api/orders').set(A)).status === 401, 'the removed device’s token stops working immediately');
  check((await login('admin@test.com', 'admin-pc')).status === 403, 'signing in again needs a new approval');
  const selfRm = await api().post(`/api/security/users/${owner._id}/devices/remove`).set(S).send({ deviceId: 'owner-laptop' });
  check(selfRm.status === 400, 'Super Admin cannot remove the device they are using', selfRm.status);

  console.log('── Old tokens without a device ──');
  const jwt = (await import('jsonwebtoken')).default;
  const legacy = jwt.sign({ _id: String(owner._id), role: 'superAdmin', email: 'owner@test.com' }, process.env.JWT_ACCESS_SECRET as string, { expiresIn: '5m' });
  check((await api().get('/api/orders').set({ Authorization: `Bearer ${legacy}` })).status === 401, 'staff token with no device id is refused (browser refreshes it)');
  const refresh = await api().post('/api/auth/refresh-token').set('x-device-id', 'owner-laptop').send({ refreshToken: sLogin.body?.data?.refreshToken });
  const fresh = refresh.body?.data?.accessToken;
  check(refresh.status === 200 && (jwt.decode(fresh) as any)?.did === 'owner-laptop', 'refresh mints a token naming the device', refresh.body);
  check((await api().get('/api/orders').set({ Authorization: `Bearer ${fresh}` })).status === 200, 'refreshed token works');

  console.log('── View as ──');
  const meAdmin = (await api().get('/api/auth/me').set(S).set('x-view-as', 'admin')).body?.data;
  check(meAdmin?.role === 'admin' && meAdmin?.realRole === 'superAdmin', '/auth/me reports the viewed role', meAdmin);
  const meMgr = (await api().get('/api/auth/me').set(S).set('x-view-as', 'manager')).body?.data;
  check(meMgr?.role === 'manager' && !meMgr?.capabilities?.includes('staff.manage'), 'manager view gets manager capabilities', meMgr?.capabilities);
  check((await api().get('/api/security/overview').set(S).set('x-view-as', 'admin')).status === 403, 'viewing as admin, the Super-Admin-only screens are shut');
  check((await api().get('/api/courier/summary').set(S).set('x-view-as', 'admin')).status === 403, 'viewing as admin, courier money is shut');
  check((await api().get('/api/courier/summary').set(S)).status === 200, 'as Super Admin it opens');
  const stuMe = (await api().get('/api/auth/me').set(st).set('x-view-as', 'admin')).body?.data;
  check(stuMe?.role === 'student', 'x-view-as is ignored on a student token', stuMe?.role);
  check((await api().get('/api/auth/me').set(S).set('x-view-as', 'superAdminX')).body?.data?.role === 'superAdmin', 'an unknown view is ignored');

  console.log('── Rollout: devices already signed in are approved ──');
  await make('mentor@test.com');
  const mentorLogin = await login('mentor@test.com', 'mentor-old'); // as a student: session made
  await User.updateOne({ email: 'mentor@test.com' }, { role: 'mentor' });
  check(mentorLogin.status === 200, 'session exists before the role change');
  const added = await SecurityService.approveExistingSessions();
  check(added >= 1, 'boot sync approves the existing session', added);
  check((await login('mentor@test.com', 'mentor-old')).status === 200, 'that device signs in without asking');
  const again = await SecurityService.approveExistingSessions();
  check(again === 0, 'boot sync is a no-op the second time', again);
  check((await StaffDevice.findOne({ deviceId: 'mgr-phone' }).lean() as any)?.status === 'rejected', 'boot sync never overrides a rejection');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
