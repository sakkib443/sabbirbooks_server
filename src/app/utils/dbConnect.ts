import mongoose from 'mongoose';

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalWithMongoose = globalThis as typeof globalThis & {
  mongooseConn?: MongooseCache;
};

if (!globalWithMongoose.mongooseConn) {
  globalWithMongoose.mongooseConn = { conn: null, promise: null };
}

export const dbConnect = async () => {
  if (globalWithMongoose.mongooseConn!.conn)
    return globalWithMongoose.mongooseConn!.conn;

  if (!globalWithMongoose.mongooseConn!.promise) {
    globalWithMongoose.mongooseConn!.promise = mongoose.connect(
      process.env.DATABASE_URL as string,
      {
        bufferCommands: false,
        // Fail fast in dev so a missing local MongoDB doesn't hang startup.
        serverSelectionTimeoutMS: 5000,
      }
    );
  }

  globalWithMongoose.mongooseConn!.conn =
    await globalWithMongoose.mongooseConn!.promise;

  return globalWithMongoose.mongooseConn!.conn;
};
