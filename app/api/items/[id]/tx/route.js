import { getDb } from '@/lib/mongo';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

const today = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return d.toISOString().slice(0, 10);
};

// 출고: 가용재고 검사 후 outbound에 적재(재고 -qty), 입고(반납): outbound에서 차감(재고 +qty)
export async function POST(req, { params }) {
  const { id } = await params;
  const { type, qty: rawQty, staff = '', popup } = await req.json();
  const qty = parseInt(rawQty) || 0;
  if (!['출고', '입고'].includes(type)) return Response.json({ error: '잘못된 유형' }, { status: 400 });
  if (qty <= 0) return Response.json({ error: '수량을 입력해주세요' }, { status: 400 });
  if (!popup?.trim()) return Response.json({ error: '팝업 행사를 입력해주세요' }, { status: 400 });

  const db = await getDb();
  const col = db.collection('items');
  const it = await col.findOne({ _id: new ObjectId(id) });
  if (!it) return Response.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });

  const outbound = (it.outbound || []).map((a) => ({ ...a }));
  const total = it.totalStock || 0;
  const popupName = popup.trim();

  if (type === '출고') {
    const currentOut = outbound.reduce((s, o) => s + o.qty, 0);
    const avail = total - currentOut;
    if (qty > avail) {
      return Response.json({ error: `가용 재고(${avail}개)보다 많이 출고할 수 없어요` }, { status: 400 });
    }
    const existing = outbound.find((o) => o.popup === popupName);
    if (existing) existing.qty += qty;
    else outbound.push({ popup: popupName, qty, staff, date: today() });
  } else {
    const alloc = outbound.find((o) => o.popup === popupName);
    if (!alloc) return Response.json({ error: '해당 출고 건을 찾을 수 없어요' }, { status: 400 });
    if (qty > alloc.qty) {
      return Response.json({ error: `반납 수량이 출고 수량(${alloc.qty}개)보다 많아요` }, { status: 400 });
    }
    alloc.qty -= qty;
    if (alloc.qty <= 0) outbound.splice(outbound.indexOf(alloc), 1);
  }

  const history = (it.history || []).slice();
  history.push({ date: today(), type, qty, popup: popupName, staff });
  if (history.length > 50) history.splice(0, history.length - 50);

  await col.updateOne({ _id: it._id }, { $set: { outbound, history, updatedAt: new Date() } });
  const { _id, ...rest } = it;
  return Response.json({ id: _id.toString(), ...rest, outbound, history });
}
