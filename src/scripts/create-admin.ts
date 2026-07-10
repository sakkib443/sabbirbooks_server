/**
 * Create (or promote) an admin user in the connected database.
 * Run from the `server/` dir:  npx ts-node --transpile-only src/scripts/create-admin.ts
 * Reads DATABASE_URL from server/.env (points at MongoDB Atlas).
 */
import config from '../app/config'; // side effect: loads dotenv
import mongoose from 'mongoose';
import { User } from '../app/modules/user/user.model';

const EMAIL = 'admin@gmail.com';
const PASSWORD = 'admin@gmail.com';

async function run() {
  const url = config.database_url;
  if (!url) throw new Error('DATABASE_URL is not set in server/.env');
  await mongoose.connect(url);
  console.log('🗄️  Connected to DB');

  let user = await User.findOne({ email: EMAIL });
  if (user) {
    user.role = 'admin';
    user.status = 'active';
    user.isDeleted = false;
    user.password = PASSWORD; // pre-save hook hashes it
    user.isPasswordChanged = false;
    await user.save();
    console.log('✅ Existing user updated → admin:', EMAIL);
  } else {
    user = await User.create({
      id: 'ADM-' + Date.now(),
      email: EMAIL,
      firstName: 'Admin',
      lastName: 'User',
      password: PASSWORD, // hashed by pre-save hook
      role: 'admin',
      status: 'active',
    });
    console.log('✅ Admin user created:', EMAIL, '(id:', user.id + ')');
  }

  const check = await User.findOne({ email: EMAIL }).select('email role status id');
  console.log('🔎 Verify:', JSON.stringify(check));
  console.log('🔑 Login →  email: admin@gmail.com   password: admin@gmail.com');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error('❌ ERROR:', e?.message || e);
  process.exit(1);
});
