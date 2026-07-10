/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── SSLCommerz Payment Service (Demo/Sandbox Mode) ──────────
// In production, replace demo logic with real SSLCommerz API calls
// Docs: https://developer.sslcommerz.com/doc/v4/

import config from '../../config';

const IS_DEMO = !config.sslcommerz.store_id || config.sslcommerz.store_id === 'demo';
const BASE_URL = config.sslcommerz.is_live
  ? 'https://securepay.sslcommerz.com'
  : 'https://sandbox.sslcommerz.com';

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
  if (IS_DEMO) {
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
  formData.append('success_url', `${config.client_url}/payment/sslcommerz/success`);
  formData.append('fail_url', `${config.client_url}/payment/sslcommerz/fail`);
  formData.append('cancel_url', `${config.client_url}/payment/sslcommerz/cancel`);
  formData.append('ipn_url', `${config.client_url.replace('3000', '5000')}/api/payment/sslcommerz/ipn`);
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

  const response = await fetch(`${BASE_URL}/gwprocess/v4`, {
    method: 'POST',
    body: formData,
  });

  return response.json();
};

// ── 2. Validate Transaction ──────────────────────────────────
const validateTransaction = async (valId: string) => {
  if (IS_DEMO) {
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

  const url = `${BASE_URL}/validator/api/validationserverAPI.php?val_id=${valId}&store_id=${config.sslcommerz.store_id}&store_passwd=${config.sslcommerz.store_pass}&format=json`;
  const response = await fetch(url);
  return response.json();
};

export const SslcommerzService = {
  initSession,
  validateTransaction,
};
