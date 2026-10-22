/**
 * Money books (20 Oct 2026; two books since 23 Oct 2026).
 *
 *   shop      the shop's income and expense that is not a website order —
 *             printing, paper, courier, ads, salaries, rent, books sold by
 *             hand. Written by the Super Admin and by admins; an admin sees
 *             only what they wrote themselves. The orders' sales are added
 *             beside these per day by ledger.service, not copied in here.
 *   personal  the Super Admin's own money — where it came from and where it
 *             went. Nobody else ever sees it, and it is never mixed into the
 *             shop's figures.
 *
 * `day` is an Accounts day, 'YYYY-MM-DD' — it starts at the hour in Settings
 * (ledgerDayStartHour, 5 AM by default) and runs to the same hour the next day.
 */
import { Schema, model, Types } from 'mongoose';

const ledgerEntrySchema = new Schema(
  {
    book: { type: String, enum: ['shop', 'personal'], default: 'shop', index: true },
    day: { type: String, required: true, index: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    category: { type: String, trim: true, default: 'অন্যান্য' },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'bkash', 'nagad', 'bank', 'other'], default: 'cash' },
    note: { type: String, trim: true, default: '' },
    createdBy: { type: Types.ObjectId, ref: 'User', default: null, index: true },
  },
  { timestamps: true }
);

export const LedgerEntry = model('LedgerEntry', ledgerEntrySchema);
