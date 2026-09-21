/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Forgot password, reset by email link, an admin setting a password, and the
 * old master-key backdoor staying shut
 * (isolated in-memory MongoDB, real Express app via supertest; never the live DB).
 *
 * Email is intercepted rather than sent: the reset link is read out of the
 * message the way the account owner would read it out of their inbox.
 *
 * Run:  npx ts-node --transpile-only src/__tests__/password-reset.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
  process.env.CLIENT_URL = 'https://shop.test';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { User } = await import('../app/modules/user/user.model');
  const { EmailService } = await import('../app/modules/notification/email.service');
  const { AuthService } = await import('../app/modules/auth/auth.service');
  const api = () => request(app);

  // Every email the code sends lands here instead of in an inbox.
  const sent: { to: string; subject: string; html: string }[] = [];
  (EmailService as any).sendEmail = async (to: string, subject: string, html: string) => {
    sent.push({ to, subject, html });
    return { success: true };
  };
  const linkIn = (html: string) => {
    const m = html.match(/reset-password[?]email=([^&"]+)&(amp;)?token=([0-9a-f]{64})/);
    return m ? { email: decodeURIComponent(m[1]), token: m[3] } : null;
  };

  const register = async (email: string, phone: string, password: string) => {
    await api().post('/api/auth/register').send({
      firstName: 'Test', lastName: 'User', email, password, whatsappNumber: phone,
    });
    await User.updateOne({ email }, { status: 'active' });
  };
  const login = (identifier: string, password: string, device = 'dev-1') =>
    api().post('/api/auth/login').set('x-device-id', device).send({ email: identifier, password });

  await register('rahim@test.com', '01711000001', 'oldpass1');

  console.log('\n── Asking for a link ──');
  {
    const r = await api().post('/api/auth/forgot-password').send({ email: 'Rahim@Test.com ' });
    await wait(300);
    check(r.status === 200, `forgot-password answers 200 (${r.status})`);
    check(sent.length === 1 && sent[0].to === 'rahim@test.com', 'one email, to the account address', sent.map((s) => s.to));
    const link = linkIn(sent[0]?.html || '');
    check(!!link, 'the email carries a reset link');
    check((sent[0]?.html || '').includes('https://shop.test/reset-password'), 'pointing at the shop site');

    const stored: any = await User.findOne({ email: 'rahim@test.com' }).select('+passwordReset').lean();
    check(!!stored?.passwordReset?.tokenHash && stored.passwordReset.tokenHash !== link?.token,
      'only a hash of the token is stored, never the token');

    const none = await api().post('/api/auth/forgot-password').send({ email: 'nobody@test.com' });
    await wait(300);
    check(none.status === 200 && none.body?.message === r.body?.message,
      'an unknown address gets the identical answer — no way to tell who has an account');
    check(sent.length === 1, 'and no email is sent for it');

    await api().post('/api/auth/forgot-password').send({ email: 'rahim@test.com' });
    await wait(300);
    check(sent.length === 1, 'asking again within a minute sends nothing more');
  }

  const link = linkIn(sent[0].html)!;

  console.log('\n── Using it ──');
  {
    const l = await login('rahim@test.com', 'oldpass1', 'phone');
    const oldRefresh = l.body?.data?.refreshToken;
    check(!!oldRefresh, 'signed in on a device before the reset');

    const wrong = await api().post('/api/auth/reset-password').send({ email: link.email, token: 'ab'.repeat(32), newPassword: 'newpass22' });
    check(wrong.status === 400, `a wrong token is refused (${wrong.status})`);

    const short = await api().post('/api/auth/reset-password').send({ email: link.email, token: link.token, newPassword: '123' });
    check(short.status === 400, `a too-short password is refused (${short.status})`);

    const ok = await api().post('/api/auth/reset-password').send({ email: link.email, token: link.token, newPassword: 'newpass22' });
    check(ok.status === 200, `the right token sets the password (${ok.status})`, ok.body?.message);

    check((await login('rahim@test.com', 'oldpass1')).status !== 200, 'the old password no longer works');
    check((await login('rahim@test.com', 'newpass22')).status === 200, 'the new one does');

    const refresh = await api().post('/api/auth/refresh-token').set('x-device-id', 'phone').send({ refreshToken: oldRefresh });
    check(refresh.status === 401, `the device signed in before is signed out (${refresh.status})`);

    await wait(200);
    check(sent.some((s) => s.to === 'rahim@test.com' && s.subject.includes('বদলানো')), 'the owner is told the password changed');

    const again = await api().post('/api/auth/reset-password').send({ email: link.email, token: link.token, newPassword: 'another33' });
    check(again.status === 400, `the same link cannot be used twice (${again.status})`);
  }

  console.log('\n── An old link ──');
  {
    await User.updateOne({ email: 'rahim@test.com' }, { $unset: { passwordReset: 1 } });
    const before = sent.length;
    // Straight to the service: the per-address hourly throttle has already
    // counted this address's earlier requests, and that is not what this tests.
    await AuthService.requestPasswordReset('rahim@test.com');
    const fresh = linkIn(sent[sent.length - 1]?.html || '');
    check(sent.length === before + 1 && !!fresh, 'a new link can be asked for');
    await User.updateOne({ email: 'rahim@test.com' }, { $set: { 'passwordReset.expiresAt': new Date(Date.now() - 1000) } });
    const expired = await api().post('/api/auth/reset-password').send({ email: fresh?.email, token: fresh?.token, newPassword: 'late44444' });
    check(expired.status === 400, `an expired link is refused (${expired.status})`);
  }

  console.log('\n── The hash never leaks ──');
  {
    const l = await login('rahim@test.com', 'newpass22', 'lap');
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${l.body?.data?.accessToken}`);
    const body = JSON.stringify(me.body);
    check(me.status === 200 && !body.includes('passwordReset') && !body.includes('tokenHash'),
      '/auth/me does not carry the reset record');
  }

  console.log('\n── An admin sets a password ──');
  await register('owner@test.com', '01711000002', 'ownerpass1');
  await User.updateOne({ email: 'owner@test.com' }, { role: 'admin' });
  await register('mgr@test.com', '01711000003', 'mgrpass11');
  await User.updateOne({ email: 'mgr@test.com' }, { role: 'manager' });
  await register('boss@test.com', '01711000004', 'bosspass1');
  await User.updateOne({ email: 'boss@test.com' }, { role: 'superAdmin' });
  const tokenOf = async (email: string, pw: string) =>
    (await login(email, pw, `d-${email}`)).body?.data?.accessToken;
  const ownerTok = await tokenOf('owner@test.com', 'ownerpass1');
  const mgrTok = await tokenOf('mgr@test.com', 'mgrpass11');
  const student: any = await User.findOne({ email: 'rahim@test.com' }).lean();
  const boss: any = await User.findOne({ email: 'boss@test.com' }).lean();
  {
    const studentLogin = await login('rahim@test.com', 'newpass22', 'tab');
    const set = await api().patch(`/api/user/${student._id}/password`).set('Authorization', `Bearer ${ownerTok}`).send({ newPassword: 'fromadmin1' });
    check(set.status === 200, `an admin sets a student's password (${set.status})`, set.body?.message);
    check((await login('rahim@test.com', 'fromadmin1')).status === 200, 'the student can sign in with it');
    const r = await api().post('/api/auth/refresh-token').set('x-device-id', 'tab').send({ refreshToken: studentLogin.body?.data?.refreshToken });
    check(r.status === 401, `and was signed out of the devices they were on (${r.status})`);
    const after: any = await User.findById(student._id).lean();
    check(after?.isPasswordChanged === false, 'and will be asked to choose their own');
    await wait(200);
    check(sent.some((s) => s.to === 'rahim@test.com' && s.html.includes('অ্যাডমিন')), 'and is emailed that an admin changed it');

    const byMgr = await api().patch(`/api/user/${student._id}/password`).set('Authorization', `Bearer ${mgrTok}`).send({ newPassword: 'mgrchose1' });
    check(byMgr.status === 403, `a plain manager (no users.write) cannot (${byMgr.status})`);

    // A training manager holds users.write and manages students — as on the Users screen.
    await register('tm@test.com', '01711000005', 'tmpass111');
    await User.updateOne({ email: 'tm@test.com' }, { role: 'trainingManager' });
    const tmTok = await tokenOf('tm@test.com', 'tmpass111');
    const owner: any = await User.findOne({ email: 'owner@test.com' }).lean();
    const tmStudent = await api().patch(`/api/user/${student.id}/password`).set('Authorization', `Bearer ${tmTok}`).send({ newPassword: 'fromtm111' });
    check(tmStudent.status === 200, `a training manager can set a student's (addressed by readable id) (${tmStudent.status})`, tmStudent.body?.message);
    const tmOwner = await api().patch(`/api/user/${owner._id}/password`).set('Authorization', `Bearer ${tmTok}`).send({ newPassword: 'fromtm222' });
    check(tmOwner.status === 403, `but not an admin's (${tmOwner.status})`);

    const viaEdit = await api().patch(`/api/user/${student._id}`).set('Authorization', `Bearer ${ownerTok}`).send({ firstName: 'Rahim', password: 'sneaky111' });
    check(viaEdit.status === 400, `a plain edit no longer takes a password (${viaEdit.status})`);

    const upward = await api().patch(`/api/user/${boss._id}/password`).set('Authorization', `Bearer ${ownerTok}`).send({ newPassword: 'takeover1' });
    check(upward.status === 403, `an admin cannot set a super admin's password (${upward.status})`);

    const weak = await api().patch(`/api/user/${student._id}/password`).set('Authorization', `Bearer ${ownerTok}`).send({ newPassword: '12' });
    check(weak.status === 400, `a too-short password is refused here too (${weak.status})`);

    const noAuth = await api().patch(`/api/user/${student._id}/password`).send({ newPassword: 'nobody111' });
    check(noAuth.status === 401, `nor can someone not signed in (${noAuth.status})`);
  }

  console.log('\n── The old master key ──');
  {
    const bd = await login('admin@sabbirbook.com', 'Admin@123456');
    check(bd.status !== 200, `the published credentials no longer sign anyone in (${bd.status})`);
    check(!(await User.findOne({ email: 'admin@sabbirbook.com' })), 'and no longer conjure an account into existence');

    // As it may exist in a database the backdoor once touched.
    await User.create({
      firstName: 'Super', lastName: 'Admin', email: 'admin@sabbirbook.com', phoneNumber: '+8801700000000',
      password: 'Admin@123456', role: 'superAdmin', status: 'active', id: 'sbb-admin-001',
    } as any);
    check((await login('admin@sabbirbook.com', 'Admin@123456')).status === 200,
      '(an account left on that password would still let them in…)');
    check((await AuthService.retireDefaultAdminPassword()) === true, 'startup replaces the published password');
    check((await login('admin@sabbirbook.com', 'Admin@123456')).status !== 200, '…and after it, it does not');
    check((await AuthService.retireDefaultAdminPassword()) === false, 'and does nothing on the next boot');
  }

  await mongoose.disconnect();
  await mongod.stop();
  console.log(failed === 0 ? `\n✅ ALL PASS — ${passed} passed, 0 failed` : `\n❌ FAILURES — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});
