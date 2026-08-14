import { Schema, model } from 'mongoose';

/**
 * A tiny atomic sequence generator.
 *
 * One document per named counter (`_id` is the name). The only write is an
 * atomic `$inc` inside `findByIdAndUpdate`, so two orders created in the same
 * millisecond can never be handed the same number — unlike `countDocuments()+1`,
 * which races.
 */
interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const Counter = model<ICounter>('Counter', counterSchema);

/**
 * Next value for a named sequence — atomic and race-safe.
 *
 * `seedIfEmpty` runs only when the counter does not exist yet. Orders use it to
 * seed the counter to the current order count, so that a brand-new order created
 * before the backfill runs still gets a number ABOVE the existing rows (which
 * the backfill later numbers 1..N by creation order). Both orderings converge on
 * the same, stable numbering.
 */
export const getNextSequence = async (
  name: string,
  seedIfEmpty?: () => Promise<number>,
): Promise<number> => {
  if (seedIfEmpty) {
    const existing = await Counter.findById(name);
    if (!existing) {
      const base = await seedIfEmpty();
      // $setOnInsert so a concurrent request that already created the counter
      // wins — we never stomp an existing sequence back down to the seed.
      await Counter.updateOne({ _id: name }, { $setOnInsert: { seq: base } }, { upsert: true });
    }
  }

  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return doc!.seq;
};

/** The counter name orders draw from. Kept here so the backfill and the service agree. */
export const ORDER_SEQ = 'order';
