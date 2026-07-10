/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── bKash Payment Service (Demo/Sandbox Mode) ──────────────
// In production, replace demo logic with real bKash Tokenized API calls
// Docs: https://developer.bka.sh/docs

import config from '../../config';

// ── Demo Mode — simulates bKash flow without real API ────────
const IS_DEMO = !config.bkash.app_key || config.bkash.app_key === 'demo';

// ── Token Store (in-memory for demo) ─────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

// ── 1. Get Grant Token ───────────────────────────────────────
const getToken = async (): Promise<string> => {
  // Demo mode
  if (IS_DEMO) {
    return 'demo_bkash_token_' + Date.now();
  }

  // Check cached token
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  // Real bKash API call (production)
  const response = await fetch(config.bkash.grant_token_url!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      username: config.bkash.username!,
      password: config.bkash.password!,
    },
    body: JSON.stringify({
      app_key: config.bkash.app_key,
      app_secret: config.bkash.app_secret,
    }),
  });

  const data = await response.json();
  if (data.id_token) {
    cachedToken = {
      token: data.id_token,
      expiresAt: Date.now() + 3500 * 1000, // ~1 hour
    };
    return data.id_token;
  }

  throw new Error('bKash token grant failed: ' + (data.statusMessage || 'Unknown error'));
};

// ── 2. Create Payment ────────────────────────────────────────
const createPayment = async (payload: {
  amount: number;
  courseId: string;
  studentId: string;
  invoiceNumber: string;
}) => {
  const { amount, courseId, studentId, invoiceNumber } = payload;

  // Demo mode — return mock payment response
  if (IS_DEMO) {
    const paymentID = `DEMO_PAY_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return {
      paymentID,
      bkashURL: `${config.client_url}/payment/bkash/demo?paymentID=${paymentID}&amount=${amount}&courseId=${courseId}`,
      amount: String(amount),
      intent: 'sale',
      currency: 'BDT',
      merchantInvoiceNumber: invoiceNumber,
      statusCode: '0000',
      statusMessage: 'Successful',
      isDemo: true,
    };
  }

  // Real bKash API call (production)
  const token = await getToken();
  const callbackURL = `${config.client_url}/payment/bkash/callback`;

  const response = await fetch('https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'X-APP-Key': config.bkash.app_key!,
    },
    body: JSON.stringify({
      mode: '0011',
      payerReference: studentId,
      callbackURL,
      amount: String(amount),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: invoiceNumber,
    }),
  });

  return response.json();
};

// ── 3. Execute Payment (after user completes on bKash) ───────
const executePayment = async (paymentID: string) => {
  // Demo mode
  if (IS_DEMO) {
    return {
      paymentID,
      trxID: `DEMO_TRX_${Date.now()}`,
      amount: '0',
      transactionStatus: 'Completed',
      paymentExecuteTime: new Date().toISOString(),
      customerMsisdn: '01XXXXXXXXX',
      statusCode: '0000',
      statusMessage: 'Successful',
      isDemo: true,
    };
  }

  // Real bKash API call
  const token = await getToken();
  const response = await fetch('https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'X-APP-Key': config.bkash.app_key!,
    },
    body: JSON.stringify({ paymentID }),
  });

  return response.json();
};

// ── 4. Query Payment Status ──────────────────────────────────
const queryPayment = async (paymentID: string) => {
  if (IS_DEMO) {
    return {
      paymentID,
      transactionStatus: 'Completed',
      statusCode: '0000',
      isDemo: true,
    };
  }

  const token = await getToken();
  const response = await fetch('https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout/payment/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'X-APP-Key': config.bkash.app_key!,
    },
    body: JSON.stringify({ paymentID }),
  });

  return response.json();
};

export const BkashService = {
  getToken,
  createPayment,
  executePayment,
  queryPayment,
};
