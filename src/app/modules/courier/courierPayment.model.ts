import { Schema, model } from 'mongoose';

/**
 * A payout the courier has made to the shop — the money it collected on
 * delivered parcels, less its delivery charges. Copied from Steadfast's
 * /payments so the shop's books do not depend on Steadfast being reachable,
 * and so each payout can be traced to the orders it settled.
 */
const courierPaymentSchema = new Schema(
  {
    provider: { type: String, default: 'steadfast' },
    paymentId: { type: String, required: true },
    amount: { type: Number, default: 0 },
    status: { type: String, default: '' },
    paidAt: { type: Date },
    consignments: {
      type: [
        new Schema(
          {
            consignmentId: String,
            invoice: String,
            trackingCode: String,
            codAmount: Number,
            deliveryCharge: Number,
            status: String,
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Totals over its consignments, kept for the list view.
    codTotal: { type: Number, default: 0 },
    chargeTotal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

courierPaymentSchema.index({ provider: 1, paymentId: 1 }, { unique: true });
courierPaymentSchema.index({ paidAt: -1 });

export const CourierPayment = model('CourierPayment', courierPaymentSchema);
