import { getDb } from '@/lib/mongo';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

const today = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return d.toISOString().slice(0, 10);
};

// 회수 완료: 해당 팝업으로 출고된 모든 집기를 재고로 복귀시키고 팝업 상태를 '회수완료'로 변경
export async function POST(req, { params }) {
  const { id } = await params;
  const { staff = '' } = await req.json().catch(() => ({}));
  const db = await getDb();
  const popup = await db.collection('popups').findOne({ _id: new ObjectId(id) });
  if (!popup) return Response.json({ error: '팝업을 찾을 수 없습니다.' }, { status: 404 });

  const col = db.collection('items');
  const affected = await col.find({ 'outbound.popup': popup.name }).toArray();

  let returnedItems = 0;
  let returnedQty = 0;
  for (const it of affected) {
    const allocs = (it.outbound || []).filter((o) => o.popup === popup.name);
    const qty = allocs.reduce((s, o) => s + o.qty, 0);
    if (qty <= 0) continue;
    const outbound = (it.outbound || []).filter((o) => o.popup !== popup.name);
    const history = (it.history || []).slice();
    history.push({ date: today(), type: '입고', qty, popup: popup.name, staff: staff || '회수완료' });
    if (history.length > 50) history.splice(0, history.length - 50);
    await col.updateOne({ _id: it._id }, { $set: { outbound, history, updatedAt: new Date() } });
    returnedItems += 1;
    returnedQty += qty;
  }

  await db.collection('popups').updateOne(
    { _id: popup._id },
    { $set: { status: '회수완료', retrievedAt: new Date(), updatedAt: new Date() } }
  );

  return Response.json({ ok: true, returnedItems, returnedQty });
}
