import puppeteer from 'puppeteer';

interface InvoiceData {
  invoiceNumber: string;
  date: string;
  studentName: string;
  studentEmail: string;
  studentPhone?: string;
  courseName: string;
  courseType?: string;
  batchName?: string;
  amount: number;
  paymentMethod: string;
  transactionId?: string;
  paidAt?: string;
  status: string;
  // Money-receipt extras (admission / installment / full / mock)
  receiptType?: 'admission' | 'installment' | 'full' | 'mock';
  totalFee?: number;
  totalPaid?: number;
  dueAmount?: number;
  installmentNumber?: number;
}

const RECEIPT_LABEL: Record<string, string> = {
  admission: 'Admission', installment: 'Installment', full: 'Full Payment', mock: 'Mock Test',
};
const tk = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

const generateInvoiceHTML = (data: InvoiceData): string => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #334155; background: #fff; }
    .invoice { max-width: 800px; margin: 0 auto; padding: 48px; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 44px; padding-bottom: 24px; border-bottom: 3px solid #F3A522; }
    .logo-section svg { height: 66px; width: auto; display: block; }
    .logo-section p { font-size: 14px; color: #94a3b8; margin-top: 10px; }
    .invoice-meta { text-align: right; }
    .invoice-meta h2 { font-size: 38px; color: #d88f13; font-weight: 800; letter-spacing: 2px; margin-bottom: 10px; }
    .invoice-meta p { font-size: 15px; color: #64748b; line-height: 1.75; }
    .invoice-meta strong { color: #0f172a; }

    /* Status */
    .status-badge { display: inline-block; padding: 5px 18px; border-radius: 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
    .status-paid { background: #dcfce7; color: #16a34a; }
    .status-pending { background: #fef3c7; color: #d97706; }
    .status-failed { background: #fee2e2; color: #dc2626; }

    /* Info Sections */
    .info-grid { display: flex; gap: 40px; margin-bottom: 36px; }
    .info-box { flex: 1; }
    .info-box h3 { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; font-weight: 700; }
    .info-box p { font-size: 16px; line-height: 1.85; color: #475569; }
    .info-box p strong { color: #0f172a; }

    /* Table */
    .table-container { margin-bottom: 36px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f1f5f9; padding: 14px 16px; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; text-align: left; font-weight: 700; }
    tbody td { padding: 18px 16px; font-size: 16px; border-bottom: 1px solid #f1f5f9; }
    tbody tr:last-child td { border-bottom: none; }
    .course-title { font-size: 18px; font-weight: 600; color: #0f172a; }
    .course-type { font-size: 13px; color: #94a3b8; margin-top: 4px; }

    /* Totals */
    .totals { display: flex; justify-content: flex-end; margin-bottom: 44px; }
    .totals-box { width: 340px; }
    .totals-row { display: flex; justify-content: space-between; padding: 10px 0; font-size: 16px; color: #64748b; }
    .totals-row.total { border-top: 2px solid #F3A522; padding-top: 14px; margin-top: 8px; font-size: 24px; font-weight: 800; color: #0f172a; }
    .totals-row.total span:last-child { color: #d88f13; }

    /* Payment Info */
    .payment-info { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 36px; }
    .payment-info h3 { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 14px; }
    .payment-grid { display: flex; gap: 32px; }
    .payment-item { font-size: 15px; }
    .payment-item label { display: block; color: #94a3b8; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
    .payment-item span { color: #0f172a; font-weight: 600; }

    /* Footer */
    .footer { text-align: center; padding-top: 28px; border-top: 1px solid #e2e8f0; }
    .footer p { font-size: 14px; color: #94a3b8; line-height: 1.9; }
    .footer a { color: #d88f13; text-decoration: none; }

    /* Watermark */
    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 92px; color: rgba(243, 165, 34, 0.07); font-weight: 900; pointer-events: none; z-index: 0; }
  </style>
</head>
<body>
  <div class="watermark">APTECH LEARNING</div>
  <div class="invoice">
    <!-- Header -->
    <div class="header">
      <div class="logo-section">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 80" role="img" aria-label="Aptech Learning">
          <g transform="translate(4,6)">
            <g fill="#9AA0A8">
              <ellipse cx="34" cy="46" rx="21" ry="17"/>
              <ellipse cx="12" cy="24" rx="8" ry="10" transform="rotate(-18 12 24)"/>
              <ellipse cx="32" cy="14" rx="8.5" ry="11"/>
              <ellipse cx="53" cy="18" rx="8" ry="10.5" transform="rotate(14 53 18)"/>
              <ellipse cx="65" cy="34" rx="7" ry="9" transform="rotate(32 65 34)"/>
            </g>
            <g fill="#F3A522">
              <ellipse cx="34" cy="48" rx="10.5" ry="8.5"/>
              <ellipse cx="24" cy="34" rx="4" ry="5" transform="rotate(-18 24 34)"/>
              <ellipse cx="34" cy="29" rx="4.2" ry="5.4"/>
              <ellipse cx="45" cy="32" rx="4" ry="5.2" transform="rotate(14 45 32)"/>
            </g>
          </g>
          <text x="86" y="42" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="800" font-style="italic" fill="#F3A522">Aptech</text>
          <text x="87" y="67" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="800" letter-spacing="1.5" fill="#181B20">LEARNING</text>
        </svg>
        <p>Your Gateway to Tech Excellence</p>
      </div>
      <div class="invoice-meta">
        <h2>${data.receiptType ? 'RECEIPT' : 'INVOICE'}</h2>
        <p>
          ${data.receiptType ? `<strong>Type:</strong> ${RECEIPT_LABEL[data.receiptType] || 'Payment'}${data.receiptType === 'installment' && data.installmentNumber ? ` #${data.installmentNumber}` : ''}<br>` : ''}
          <strong>${data.receiptType ? 'Receipt' : 'Invoice'} #:</strong> ${data.invoiceNumber}<br>
          <strong>Date:</strong> ${data.date}<br>
          <span class="status-badge status-${data.status.toLowerCase()}">${data.status}</span>
        </p>
      </div>
    </div>

    <!-- Info Grid -->
    <div class="info-grid">
      <div class="info-box">
        <h3>Billed To</h3>
        <p>
          <strong>${data.studentName}</strong><br>
          ${data.studentEmail}<br>
          ${data.studentPhone || ''}
        </p>
      </div>
      <div class="info-box">
        <h3>From</h3>
        <p>
          <strong>Aptech Learning</strong><br>
          Dhaka, Bangladesh<br>
          info@aptechlearning.com
        </p>
      </div>
    </div>

    <!-- Table -->
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 60%">Course</th>
            <th>Batch</th>
            <th style="text-align: right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="course-title">${data.courseName}</div>
              <div class="course-type">${data.courseType || 'Online Course'}</div>
            </td>
            <td>${data.batchName || 'N/A'}</td>
            <td style="text-align: right; font-weight: 600;">৳${data.amount.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Totals -->
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row">
          <span>${data.receiptType === 'installment' ? 'Paid this time' : 'Amount'}</span>
          <span>${tk(data.amount)}</span>
        </div>
        ${typeof data.totalFee === 'number' ? `<div class="totals-row"><span>Total Fee</span><span>${tk(data.totalFee)}</span></div>` : ''}
        ${typeof data.totalPaid === 'number' ? `<div class="totals-row"><span>Total Paid</span><span>${tk(data.totalPaid)}</span></div>` : ''}
        ${typeof data.dueAmount === 'number'
      ? `<div class="totals-row total" style="border-top-color:${data.dueAmount > 0 ? '#f59e0b' : '#10b981'};"><span>${data.dueAmount > 0 ? 'Remaining Due' : 'Fully Paid'}</span><span style="color:${data.dueAmount > 0 ? '#d97706' : '#10b981'} !important;">${tk(data.dueAmount)}</span></div>`
      : `<div class="totals-row total"><span>Total</span><span>${tk(data.amount)}</span></div>`}
      </div>
    </div>

    <!-- Payment Info -->
    <div class="payment-info">
      <h3>Payment Information</h3>
      <div class="payment-grid">
        <div class="payment-item">
          <label>Method</label>
          <span>${data.paymentMethod.toUpperCase()}</span>
        </div>
        <div class="payment-item">
          <label>Transaction ID</label>
          <span>${data.transactionId || 'N/A'}</span>
        </div>
        <div class="payment-item">
          <label>Paid At</label>
          <span>${data.paidAt || 'N/A'}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>
        Thank you for choosing Aptech Learning!<br>
        For any queries, contact us at <a href="mailto:info@aptechlearning.com">info@aptechlearning.com</a><br>
        <small>This is a computer-generated ${data.receiptType ? 'receipt' : 'invoice'} and does not require a signature.</small>
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

// ─── Generate PDF Buffer ────────────────────────────────────
export const generateInvoicePDF = async (data: InvoiceData): Promise<Buffer> => {
  const html = generateInvoiceHTML(data);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' as never });

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
  });

  await browser.close();
  return Buffer.from(pdfBuffer);
};

export const InvoiceService = {
  generateInvoicePDF,
  generateInvoiceHTML,
};
