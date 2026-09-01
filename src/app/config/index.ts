import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export default {
  port: process.env.PORT || 5000,
  database_url: process.env.DATABASE_URL,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || '12',

  // JWT
  //
  // The access token used to default to 15m with no refresh call anywhere in the
  // client, so the admin panel logged itself out a quarter of an hour into every
  // session — mid-answer, losing unsaved work. The client now refreshes silently
  // (see the client's authFetch), but the default is 12h anyway: a token this
  // side of a working day means one dropped refresh cannot end the session, and
  // a stolen token still dies the same day. Override per-environment with
  // JWT_ACCESS_EXPIRES_IN if you want it tighter.
  jwt: {
    access_secret: process.env.JWT_ACCESS_SECRET as string,
    access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN || '12h',
    refresh_secret: process.env.JWT_REFRESH_SECRET as string,
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  // Google Sign-In (OpenID Connect)
  //
  // Get these from https://console.cloud.google.com/apis/credentials →
  // "Create credentials" → "OAuth client ID" → Application type "Web
  // application". Add the site origin (e.g. http://localhost:3001 in dev) under
  // "Authorised JavaScript origins" — the browser widget will not render for an
  // origin that is not listed.
  //
  // client_id doubles as the FEATURE FLAG. It is the `audience` every incoming
  // ID token is verified against, so without it there is no safe way to accept
  // one: the route answers 503 "not configured" and the client renders no
  // button. Nothing crashes at boot when it is absent — that is the state this
  // ships in.
  //
  // The SAME id must be set on the client as NEXT_PUBLIC_GOOGLE_CLIENT_ID. A
  // mismatch means every token is minted for the wrong audience and rejected.
  google: {
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    // A SECOND accepted audience, for when more than one Google client id can
    // legitimately mint tokens for this backend (a web client plus an Android
    // one, or a migration between Cloud projects). Optional — leave it blank
    // and the primary id is the only audience accepted.
    //
    // ⚠ This is a TRUST DECISION, not a convenience setting. Whoever controls
    // the listed OAuth client can mint ID tokens this server will accept, so
    // only ever put a client id YOU own here. It is an explicit allow-list read
    // from the environment: no value from a request can ever widen it.
    client_id_alt: process.env.GOOGLE_CLIENT_ID_ALT || '',
    // Only used by the server-side authorization-code exchange, which this
    // flow does NOT perform — Google Identity Services hands the browser a
    // signed ID token directly and we verify that. Read here so a future code
    // flow has one place to find it; leaving it blank changes nothing today.
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
  },

  // Cloudinary
  cloudinary: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  },

  // SSLCommerz
  sslcommerz: {
    store_id: process.env.SSLCOMMERZ_STORE_ID,
    store_pass: process.env.SSLCOMMERZ_STORE_PASS,
    is_live: process.env.SSLCOMMERZ_IS_LIVE === 'true',
  },

  // bKash
  bkash: {
    app_key: process.env.BKASH_APP_KEY,
    app_secret: process.env.BKASH_APP_SECRET,
    username: process.env.BKASH_USERNAME,
    password: process.env.BKASH_PASSWORD,
    grant_token_url: process.env.BKASH_GRANT_TOKEN_URL,
  },

  // Email (Gmail SMTP) — fill SMTP_USER + SMTP_PASS (Gmail App Password) in .env to enable real sending
  email: {
    smtp_user: process.env.SMTP_USER,
    smtp_pass: process.env.SMTP_PASS,
    from_email: process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@sabbirbook.com',
    from_name: process.env.MAIL_FROM_NAME || 'Sabbir Book',
    sendgrid_api_key: process.env.SENDGRID_API_KEY, // legacy, unused
  },

  // SMS — real sending switches on as soon as an API key exists (no source-level
  // DEMO flag; see notification/sms.service.ts).
  // SMS — MiMSMS (sms.mimsms.com).
  //
  // The username is the email the shop signs into the panel with; there is no
  // separate API username. The key is minted in the panel's Developer menu and
  // must be activated there, and MiMSMS will refuse calls from a server whose
  // IP is not whitelisted — so an unset key and a live key that returns 403
  // are both normal states this has to survive. See notification/sms.service.ts.
  //
  // Nothing here has a real default: an empty key means "log the message and
  // skip", which is what a dev machine should do, and what production should do
  // rather than crash.
  sms: {
    username: process.env.SMS_USERNAME || '',
    api_key: process.env.SMS_API_KEY || '',
    // The non-masking numeric sender the shop's pack was bought under. A
    // masking (brand-name) sender is the same field with a different value.
    sender_id: process.env.SMS_SENDER_ID || '',
    // 'T' is transactional — order and account messages, which is all we send.
    transaction_type: process.env.SMS_TRANSACTION_TYPE || 'T',
    // Overridable so a gateway path change does not need a redeploy.
    endpoint: process.env.SMS_ENDPOINT || 'https://api.mimsms.com/api/SmsSending/OneToMany',
  },

  // Order alerts (WhatsApp + Telegram).
  //
  // Credentials live HERE and only here. GET /api/settings is public and returns
  // the whole settings document, so a bot token stored there would be readable
  // by anyone. Every field below is optional: unset means "log and skip", never
  // a crash — see notification/orderAlert.service.ts.
  alerts: {
    shop_name: process.env.SHOP_NAME || 'Sabbir Books',
    telegram: {
      bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
      // Comma-separated — a personal chat and a staff group can both be listed.
      admin_chat_ids: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
    },
    whatsapp: {
      phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      access_token: process.env.WHATSAPP_ACCESS_TOKEN || '',
      api_version: process.env.WHATSAPP_API_VERSION || 'v21.0',
      // Admin's own WhatsApp number in international form (e.g. 8801XXXXXXXXX).
      admin_to: process.env.WHATSAPP_ADMIN_TO || '',
      // Business-initiated WhatsApp messages MUST use a template Meta approved.
      template_buyer: process.env.WHATSAPP_TEMPLATE_ORDER_BUYER || 'order_received_bn',
      template_admin: process.env.WHATSAPP_TEMPLATE_ORDER_ADMIN || 'new_order_admin_bn',
      template_lang: process.env.WHATSAPP_TEMPLATE_LANG || 'bn',
      default_country_code: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '880',
    },
  },

  // Client
  client_url: process.env.CLIENT_URL || 'http://localhost:3000',

  // Device-limit (concurrent logged-in devices per user; oldest auto-evicted)
  device_limit: Number(process.env.DEVICE_LIMIT) || 2,
};
