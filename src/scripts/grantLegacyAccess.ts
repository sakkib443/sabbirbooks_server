/* eslint-disable no-console */
/**
 * Keep the customers who bought before the codes existed.
 *
 * The book's QR content used to open when an order was delivered. It does not
 * any more — the code printed inside each copy is what opens it. That is right
 * for every book printed with a code in it, and wrong for everyone who bought
 * before those were printed: their parcel arrived, they have been reading, and
 * the day this ships they would be told the book is not theirs.
 *
 * This gives each of them an explicit grant, which is the same thing redeeming
 * a code produces. They notice nothing.
 *
 * DRY RUN BY DEFAULT. It prints who it would grant and stops. Pass APPLY=1 to
 * write, which is the same shape as updateShopSettings.ts — a script that
 * touches the live database should have to be asked twice.
 *
 *   npx ts-node --transpile-only src/scripts/grantLegacyAccess.ts
 *   APPLY=1 npx ts-node --transpile-only src/scripts/grantLegacyAccess.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const APPLY = process.env.APPLY === '1';

const main = async () => {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error('DATABASE_URL is not set');
  await mongoose.connect(uri);

  const { Order } = await import('../app/modules/order/order.model');
  const { BookAccess } = await import('../app/modules/bookAccess/bookAccess.model');
  const { User } = await import('../app/modules/user/user.model');

  console.log(APPLY ? '\n⚠  APPLYING — writing grants.\n' : '\nDry run. Nothing is written. Pass APPLY=1 to write.\n');

  // Exactly the test the old rule used: a printed copy that reached the buyer.
  const delivered: any[] = await Order.find({
    status: { $in: ['delivered', 'access-granted'] },
    'items.format': 'printed',
  })
    .select('orderNumber user items.book items.title deliveredAt')
    .lean();

  let granted = 0;
  let already = 0;
  let skipped = 0;

  for (const order of delivered) {
    if (!order.user) {
      // A guest order has nobody to grant to. Named rather than silently
      // dropped: the shop may want to reach that buyer another way.
      console.log(`  ⚠  ${order.orderNumber} — no account on the order, skipped`);
      skipped++;
      continue;
    }

    const user: any = await User.findById(order.user).select('email').lean();

    for (const item of order.items || []) {
      if (!item.book) continue;

      const existing = await BookAccess.findOne({
        userId: order.user,
        bookId: item.book,
        revokedAt: { $exists: false },
      }).lean();

      if (existing) {
        console.log(`  ·  ${user?.email} already has "${item.title}"`);
        already++;
        continue;
      }

      console.log(`  ✔  ${user?.email} → "${item.title}"  (${order.orderNumber})`);
      granted++;

      if (APPLY) {
        await BookAccess.updateOne(
          { userId: order.user, bookId: item.book },
          {
            $set: {
              source: 'manual',
              note: `Bought before book codes existed — order ${order.orderNumber}`,
            },
            $unset: { revokedAt: '' },
            $setOnInsert: { userId: order.user, bookId: item.book },
          },
          { upsert: true }
        );
      }
    }
  }

  console.log('');
  console.log(`  Delivered orders looked at : ${delivered.length}`);
  console.log(`  Grants ${APPLY ? 'written' : 'that would be written'}   : ${granted}`);
  console.log(`  Already had access         : ${already}`);
  console.log(`  Skipped (no account)       : ${skipped}`);
  if (!APPLY && granted > 0) {
    console.log('\n  Run again with APPLY=1 to write them.');
  }

  await mongoose.disconnect();
};

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
