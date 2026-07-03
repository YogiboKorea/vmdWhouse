import { getDb } from '@/lib/mongo';

export const dynamic = 'force-dynamic';

// JSON 배열 일괄 가져오기 (엑셀 변환본 / Firestore 이관 데이터)
export async function POST(req) {
  const data = await req.json();
  if (!Array.isArray(data) || !data.length) {
    return Response.json({ error: '가져올 품목이 없어요' }, { status: 400 });
  }
  const db = await getDb();
  const docs = data.map((raw) => ({
    name: raw.name || '이름없음',
    category: raw.category || '진열집기',
    status: raw.status || '사용가능',
    color: raw.color || '',
    size: raw.size || '',
    note: raw.note || '',
    totalStock: parseInt(raw.totalStock) || 0,
    thumbnail: raw.thumbnail || null,
    outbound: Array.isArray(raw.outbound) ? raw.outbound : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const result = await db.collection('items').insertMany(docs);
  return Response.json({ inserted: result.insertedCount });
}
