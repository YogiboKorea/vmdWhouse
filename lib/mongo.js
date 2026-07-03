import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI 환경변수가 설정되지 않았습니다.');

let clientPromise;
if (!global._vmdMongoClientPromise) {
  global._vmdMongoClientPromise = new MongoClient(uri).connect();
}
clientPromise = global._vmdMongoClientPromise;

export async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.VMD_DB_NAME || 'vmdWhouse');
}
