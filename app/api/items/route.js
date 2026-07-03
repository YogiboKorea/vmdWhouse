import { getDb } from '@/lib/mongo';

export const dynamic = 'force-dynamic';

const serialize = ({ _id, ...rest }) => ({ id: _id.toString(), ...rest });

export async function GET() {
  const db = await getDb();
  const list = await db.collection('items').find().sort({ createdAt: -1 }).toArray();
  return Response.json(list.map(serialize));
}

export async function POST(req) {
  const body = await req.json();
  if (!body.name?.trim()) {
    return Response.json({ error: '품목명이 필요합니다.' }, { status: 400 });
  }
  const db = await getDb();
  const doc = {
    name: body.name.trim(),
    category: body.category || '진열집기',
    status: body.status || '사용가능',
    color: body.color || '',
    size: body.size || '',
    note: body.note || '',
    totalStock: parseInt(body.totalStock) || 0,
    thumbnail: body.thumbnail || null,
    outbound: [],
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await db.collection('items').insertOne(doc);
  return Response.json(serialize({ _id: result.insertedId, ...doc }), { status: 201 });
}
