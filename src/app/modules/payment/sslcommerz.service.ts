/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── SSLCommerz Payment Service (Demo/Sandbox Mode) ──────────
// In production, replace demo logic with real SSLCommerz API calls
// Docs: https://developer.sslcommerz.com/doc/v4/

import config from '../../config';
import { serverUrl, sslcommerzHost, sslcommerzState } from './gateway.config';

// Per call rather than at import, and requires the store PASSWORD as well as the
// id — a store_id with no password cannot complete a single live call.
const isDemo = (): boolean => !sslcommerzState().configured;

// ── 1. Init Payment Session ──────────────────────────────────
const initSession = async (payload: {
  amount: number;
  courseId: string;
  courseName: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentPhone?: string;
  invoiceNumber: string;
}) => {
  const {
    amount, courseId, courseName, studentId,
    studentName, studentEmail, studentPhone, invoiceNumber,
  } = payload;

  // Demo mode
  if (isDemo()) {
    const tranId = `DEMO_SSL_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return {
      status: 'SUCCESS',
      GatewayPageURL: `${config.client_url}/payment/sslcommerz/demo?tran_id=${tranId}&amount=${amount}&courseId=${courseId}`,
      sessionkey: `demo_session_${Date.now()}`,
      tran_id: tranId,
      isDemo: true,
    };
  }

  // Real SSLCommerz API call
  const formData = new URLSearchParams();
  formData.append('store_id', config.sslcommerz.store_id!);
  formData.append('store_passwd', config.sslcommerz.store_pass!);
  formData.append('total_amount', String(amount));
  formData.append('currency', 'BDT');
  formData.append('tran_id', invoiceNumber);
  // All four point at the SERVER. SSLCommerz delivers its result as a form POST,
  // and a Next.js App Router page only answers GET — pointing these at the client
  // meant the buyer's browser POSTed into a 405 and the order was never settled.
  // The API takes the POST, settles, then 302s the browser to the client.
  //
  // The old ipn_url derived the API host by string-replacing '3000' with '5000'
  // in the client URL, which only ever worked on a dev laptop: in production the
  // client is a domain with no port in it, so the IPN was posted straight back at
  // the storefront. SERVER_URL is now explicit.
  const api = `${serverUrl()}/api/payment/sslcommerz`;
  formData.append('success_url', `${api}/success`);
  formData.append('fail_url', `${api}/fail`);
  formData.append('cancel_url', `${api}/cancel`);
  formData.append('ipn_url', `${api}/ipn`);
  formData.append('cus_name', studentName);
  formData.append('cus_email', studentEmail);
  formData.append('cus_phone', studentPhone || '01700000000');
  formData.append('cus_add1', 'Dhaka, Bangladesh');
  formData.append('cus_city', 'Dhaka');
  formData.append('cus_country', 'Bangladesh');
  formData.append('shipping_method', 'NO');
  formData.append('product_name', courseName);
  formData.append('product_category', 'Education');
  formData.append('product_profile', 'non-physical-goods');
  formData.append('value_a', courseId);
  formData.append('value_b', studentId);

  // The v4 session endpoint is /gwprocess/v4/api.php — without api.php the host
  // answers an HTML page, not a session, and the buyer never reaches a gateway.
  const response = await fetch(`${sslcommerzHost()}/gwprocess/v4/api.php`, {
    method: 'POST',
    body: formData,
  });

  return response.json();
};

// ── 2. Validate Transaction ──────────────────────────────────
const validateTransaction = async (valId: string) => {
  if (isDemo()) {
    return {
      status: 'VALID',
      tran_id: valId,
      amount: '0',
      store_amount: '0',
      card_type: 'DEMO',
      tran_date: new Date().toISOString(),
      isDemo: true,
    };
  }

  const url = `${sslcommerzHost()}/validator/api/validationserverAPI.php?val_id=${valId}&store_id=${config.sslcommerz.store_id}&store_passwd=${config.sslcommerz.store_pass}&format=json`;
  const response = await fetch(url);
  return response.json();
};

export const SslcommerzService = {
  initSession,
  validateTransaction,
};
