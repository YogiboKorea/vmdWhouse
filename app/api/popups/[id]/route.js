import { getDb } from '@/lib/mongo';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const { id } = await params;
  const db = await getDb();
  const p = await db.collection('popups').findOne({ _id: new ObjectId(id) });
  if (!p) return Response.json({ error: '팝업을 찾을 수 없습니다.' }, { status: 404 });
  const { _id, ...rest } = p;
  return Response.json({ id: _id.toString(), ...rest });
}

export async function PUT(req, { params }) {
  const { id } = await params;
  const body = await req.json();
  const db = await getDb();
  const $set = { updatedAt: new Date() };
  for (const key of ['name', 'place', 'manager', 'status', 'start', 'end']) {
    if (body[key] !== undefined) $set[key] = body[key];
  }
  // 행사명이 바뀌면 출고중인 집기(outbound)의 팝업명도 함께 변경해 연결 유지
  const prior = await db.collection('popups').findOne({ _id: new ObjectId(id) });
  if (prior && $set.name && $set.name !== prior.name) {
    await db.collection('items').updateMany(
      { 'outbound.popup': prior.name },
      { $set: { 'outbound.$[o].popup': $set.name, updatedAt: new Date() } },
      { arrayFilters: [{ 'o.popup': prior.name }] }
    );
  }
  const result = await db.collection('popups').findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set },
    { returnDocument: 'after' }
  );
  if (!result) return Response.json({ error: '팝업을 찾을 수 없습니다.' }, { status: 404 });
  const { _id, ...rest } = result;
  return Response.json({ id: _id.toString(), ...rest });
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  const db = await getDb();
  await db.collection('popups').deleteOne({ _id: new ObjectId(id) });
  return Response.json({ ok: true });
}
