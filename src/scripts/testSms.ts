/* eslint-disable no-console */
/**
 * "Is SMS actually working?" — one command, a real answer.
 *
 * Reads the same environment the server does and reports what it found, then
 * optionally sends one real text and prints the gateway's own words back. The
 * three things that go wrong on the MiMSMS side all look identical from the
 * app (no text arrives), so this exists to tell them apart:
 *
 *   key not activated   the key was created but never switched on in the
 *                       panel's Developer menu
 *   IP not whitelisted  the panel only accepts calls from listed addresses,
 *                       and a Coolify redeploy can change ours
 *   wrong sender        SenderName must match a sender registered to the
 *                       account exactly; anything else is refused
 *
 * Dry run by default — it prints the configuration and the exact message it
 * WOULD send, and stops. Nothing leaves the machine without a phone number.
 *
 *   npx ts-node --transpile-only src/scripts/testSms.ts
 *   npx ts-node --transpile-only src/scripts/testSms.ts 01712345678
 */
import 'dotenv/config';
import config from '../app/config';
import { SmsService } from '../app/modules/notification/sms.service';
import { SmsMessage } from '../app/modules/notification/sms.message';

const mask = (s: string) =>
  !s ? '(empty)' : s.length <= 6 ? '***' : `${s.slice(0, 3)}…${s.slice(-3)} (${s.length} chars)`;

const main = async () => {
  const target = process.argv[2];

  console.log('\n─── What the server sees ───────────────────────────');
  console.log(`  SMS_USERNAME          ${config.sms.username || '(empty)'}`);
  console.log(`  SMS_API_KEY           ${mask(config.sms.api_key)}`);
  console.log(`  SMS_SENDER_ID         ${config.sms.sender_id || '(empty)'}`);
  console.log(`  SMS_TRANSACTION_TYPE  ${config.sms.transaction_type}`);
  console.log(`  SMS_ENDPOINT          ${config.sms.endpoint}`);
  console.log(`  SHOP_NAME             ${config.alerts.shop_name}`);
  // The link that goes inside the delivered and affiliate texts. Unset, it is
  // localhost:3000 — a real message with a dead link in it.
  console.log(`  CLIENT_URL            ${config.client_url}`);

  if (SmsService.isDemo()) {
    console.log(
      '\n  ⚠  DEMO MODE — SMS_USERNAME or SMS_API_KEY is missing, so nothing will be sent.\n' +
        '     Set both in Coolify, redeploy, and run this again.'
    );
  } else {
    console.log('\n  ✅ Configured. Real messages will be sent.');
  }

  console.log('\n─── Asking the gateway, without spending a message ─');
  const gw = await SmsService.checkBalance();
  const senderSet = Boolean(config.sms.sender_id);

  if (SmsService.isDemo()) {
    // No key means we never called anything, so the answer below would be an
    // invented verdict about an IP we never used. Say the true thing instead.
    console.log('  — skipped: no key set, so nothing was asked.');
  } else if (gw.ok && senderSet) {
    console.log(`  ✅ MiMSMS answered. Balance: ${gw.balance || '(not reported)'}`);
    console.log('     The key is accepted and this machine is allowed to call.');
    console.log('     A sender ID is set, so the only thing left to prove is that');
    console.log('     THIS sender name is one the account owns — pass a phone');
    console.log('     number below to settle that with one real message.');
  } else if (gw.ok && !senderSet) {
    console.log(`  ⚠  MiMSMS answered — the key and the IP are both fine.`);
    console.log('     But SMS_SENDER_ID is EMPTY, and the gateway refuses every');
    console.log("     message without it. Copy it from the panel's Sender ID menu");
    console.log('     into Coolify and redeploy. That is the whole problem.');
  } else if (!gw.reachable) {
    console.log(`  ❌ MiMSMS refused this machine outright: ${gw.error}`);
    console.log('     The IP is not whitelisted. If you are running this on your');
    console.log('     laptop that is expected — only the server is whitelisted.');
    console.log('     If you are running it ON the server, then whatever address');
    console.log('     the panel lists is not the address this container leaves');
    console.log('     from. Run `curl ifconfig.me` here and give MiMSMS that.');
  } else {
    console.log(`  ❌ MiMSMS heard us but rejected the credentials: ${gw.error}`);
    console.log("     Check the key is ACTIVATED in the panel's Developer Option,");
    console.log('     and that SMS_USERNAME is the email you sign in with.');
  }

  console.log('\n─── The five messages, as they would arrive ────────');
  const order = {
    shopName: config.alerts.shop_name,
    orderNumber: 'ORD-1788284255628-LKB6BR',
    total: 610,
  };
  const samples: [string, string][] = [
    ['1. order placed (COD)', SmsMessage.orderPlaced(order)],
    ['2. payment received (prepaid)', SmsMessage.paymentReceived(order)],
    ['3. order confirmed (COD)', SmsMessage.orderConfirmed(order)],
    ['4. delivered (both)', SmsMessage.orderDelivered(order)],
    [
      '5. affiliate approved',
      SmsMessage.affiliateApproved({
        shopName: config.alerts.shop_name,
        couponCode: 'DMCSAKIB20',
        discountTk: 20,
        payoutTk: 30,
        siteUrl: String(config.client_url || 'magicviva.com').replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
      }),
    ],
  ];
  for (const [label, body] of samples) {
    console.log(`\n  ${label}  —  ${body.length} chars, ${body.length > 160 ? '⚠ TWO messages' : '1 message'}`);
    body.split('\n').forEach((l) => console.log(`    ${l}`));
  }

  if (!target) {
    console.log(
      '\n─── Nothing sent ──────────────────────────────────\n' +
        '  Pass a phone number to send a real test:\n' +
        '    npx ts-node --transpile-only src/scripts/testSms.ts 01712345678\n'
    );
    return;
  }

  const to = SmsService.normalizePhone(target);
  if (!to) {
    console.error(`\n  ❌ "${target}" is not a Bangladeshi mobile number.`);
    process.exit(1);
  }

  console.log(`\n─── Sending one test to ${to} ─────────────────`);
  const text = `${config.alerts.shop_name}\nSMS test message.\nIf you got this, the gateway is working.`;
  const result = await SmsService.send(to, text);

  if (result.demo) {
    console.log('  Demo mode — logged above, not sent.');
  } else if (result.success) {
    console.log(`  ✅ SENT. Gateway transaction id: ${result.trxnId || '(none returned)'}`);
    console.log('     Check the phone. If nothing arrives within a minute, look at');
    console.log('     the panel\'s sent-log for this transaction id.');
  } else {
    console.log(`  ❌ REFUSED: ${result.error}`);
    console.log('\n  The usual causes, in the order worth checking:');
    console.log('    1. The API key is not ACTIVATED in the panel (Developer Option).');
    console.log("    2. This machine's public IP is not whitelisted there. The live");
    console.log('       server is 164.68.126.31 — your laptop is a different address,');
    console.log('       so a refusal when running this locally is expected and fine.');
    console.log('    3. SMS_SENDER_ID does not match a sender registered to the account.');
    process.exit(1);
  }
};

main().catch((e) => {
  console.error('\n  ❌ Threw:', e?.message || e);
  process.exit(1);
});
