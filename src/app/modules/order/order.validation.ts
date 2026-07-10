import { z } from 'zod';

// ─── Shipping address (required at service layer when any printed item) ───
const shippingAddressSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(1, 'Phone is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
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
  }),
});

// ─── Admin fulfillment status update ─────────────────────────
export const updateOrderStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
  }),
});
