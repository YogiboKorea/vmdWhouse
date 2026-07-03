import { getDb } from '@/lib/mongo';

export const dynamic = 'force-dynamic';

const serialize = ({ _id, ...rest }) => ({ id: _id.toString(), ...rest });

export async function GET() {
  const db = await getDb();
  const list = await db.collection('popups').find().sort({ start: -1 }).toArray();
  return Response.json(list.map(serialize));
}

export async function POST(req) {
  const body = await req.json();
  if (!body.name?.trim()) {
    return Response.json({ error: '행사명이 필요합니다.' }, { status: 400 });
  }
  const db = await getDb();
  const doc = {
    name: body.name.trim(),
    place: body.place || '',
    manager: body.manager || '',
    status: body.status || '진행중',
    start: body.start || '',
    end: body.end || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await db.collection('popups').insertOne(doc);
  return Response.json(serialize({ _id: result.insertedId, ...doc }), { status: 201 });
}
