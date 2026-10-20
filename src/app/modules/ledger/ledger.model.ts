/**
 * The shop's own money book (20 Oct 2026): every taka in or out that is not a
 * website order — printing, paper, courier, ads, salaries, rent; and income
 * from outside the site. The orders' sales are added beside these per day by
 * ledger.service, not copied in here.
 *
 * `day` is a shop day, 'YYYY-MM-DD'.
 */
import { Schema, model, Types } from 'mongoose';

const ledgerEntrySchema = new Schema(
  {
    day: { type: String, required: true, index: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    category: { type: String, trim: true, default: 'অন্যান্য' },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'bkash', 'nagad', 'bank', 'other'], default: 'cash' },
    note: { type: String, trim: true, default: '' },
    createdBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const LedgerEntry = model('LedgerEntry', ledgerEntrySchema);
