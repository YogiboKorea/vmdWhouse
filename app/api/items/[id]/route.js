import { getDb } from '@/lib/mongo';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

export async function PUT(req, { params }) {
  const { id } = await params;
  const body = await req.json();
  const db = await getDb();
  const $set = { updatedAt: new Date() };
  for (const key of ['name', 'category', 'status', 'color', 'size', 'note', 'thumbnail']) {
    if (body[key] !== undefined) $set[key] = body[key];
  }
  if (body.totalStock !== undefined) $set.totalStock = parseInt(body.totalStock) || 0;
  const result = await db.collection('items').findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set },
    { returnDocument: 'after' }
  );
  if (!result) return Response.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  const { _id, ...rest } = result;
  return Response.json({ id: _id.toString(), ...rest });
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  const db = await getDb();
  await db.collection('items').deleteOne({ _id: new ObjectId(id) });
  return Response.json({ ok: true });
}
