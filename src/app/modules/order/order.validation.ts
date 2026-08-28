import { z } from 'zod';

// ─── Shipping address (required at service layer when any printed item) ───
const shippingAddressSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(1, 'Phone is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  // Courier zone. Optional here and defaulted server-side to the dearer zone, so
  // an old client that never sends it cannot under-pay the delivery charge.
  area: z.enum(['inside-dhaka', 'outside-dhaka']).optional(),
  // Geography, prefilled from the buyer's college. When a district is sent it
  // decides the courier zone, so `area` above becomes advisory — see createOrder.
  district: z.string().optional(),
  division: z.string().optional(),
  note: z.string().optional(),
});

// ─── CREATE order ────────────────────────────────────────────
// Body: { items:[{ bookSlugOrId, quantity }], shippingAddress? }.
// Prices/subtotal/total are computed server-side from the catalog — never trusted
// from the client — so only the book reference + quantity are accepted here.
export const createOrderValidationSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          bookSlugOrId: z.string().min(1, 'bookSlugOrId is required'),
          quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
        })
      )
      .min(1, 'At least one item is required'),
    shippingAddress: shippingAddressSchema.optional(),
    // How the buyer intends to pay. 'manual' = Send Money now + submit a TrxID,
    // 'cod' = pay the courier in cash. Defaults to manual (the pre-existing
    // behaviour) when an older client omits it.
    paymentMethod: z.enum(['manual', 'cod']).optional(),
    // An optional discount code. Re-evaluated server-side against the post-offer
    // price; an invalid code fails the order rather than being charged in full.
    couponCode: z.string().optional(),
  }),
});

// ─── Admin fulfillment status update ─────────────────────────
export const updateOrderStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
    // Optional courier details captured at the same time as "shipped".
    courierName: z.string().optional(),
    trackingCode: z.string().optional(),
    adminNote: z.string().optional(),
  }),
});

// ─── Manual payment submit (owner) ───────────────────────────
// Buyer sends Send-Money details; order stays pending for admin verification.
export const submitManualPaymentValidationSchema = z.object({
  body: z.object({
    channel: z.enum(['bkash', 'rocket', 'nagad']),
    transactionId: z.string().min(3, 'Transaction ID is required'),
    senderNumber: z.string().min(6, 'Sender number is required'),
    // ISO datetime string ("when did you send it?"); optional but recommended.
    sentAt: z.string().optional(),
    note: z.string().optional(),
  }),
});

// ─── Admin edit of payment details ───────────────────────────
export const updateOrderPaymentValidationSchema = z.object({
  body: z.object({
    channel: z.enum(['bkash', 'rocket', 'nagad']).optional(),
    method: z.enum(['bkash', 'sslcommerz', 'manual', 'cod', 'free']).optional(),
    transactionId: z.string().optional(),
    senderNumber: z.string().optional(),
    sentAt: z.string().nullable().optional(),
    note: z.string().optional(),
  }),
});
