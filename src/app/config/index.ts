import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export default {
  port: process.env.PORT || 5000,
  database_url: process.env.DATABASE_URL,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || '12',

  // JWT
  jwt: {
    access_secret: process.env.JWT_ACCESS_SECRET as string,
    access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refresh_secret: process.env.JWT_REFRESH_SECRET as string,
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
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

  // SMS
  sms: {
    api_key: process.env.BULKSMS_API_KEY,
    sender_id: process.env.BULKSMS_SENDER_ID || 'SabbirBook',
  },

  // Client
  client_url: process.env.CLIENT_URL || 'http://localhost:3000',

  // Device-limit (concurrent logged-in devices per user; oldest auto-evicted)
  device_limit: Number(process.env.DEVICE_LIMIT) || 2,
};
