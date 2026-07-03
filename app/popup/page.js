'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const LOGO = 'https://yogibo.kr/web/img/icon/logo3_on.png';
const outQtyOf = (it) => (it.outbound || []).reduce((s, o) => s + o.qty, 0);

function broadcast() {
  const bc = new BroadcastChannel('vmd-sync');
  bc.postMessage('changed');
  bc.close();
}

/* ===== 사용 집기 추가 섹션 =====
   - 팝업 저장 전: 집기를 "담기" → 저장 시 한꺼번에 출고 처리
   - 팝업 저장 후: 바로 출고/반납 */
function EquipSection({ popupId, popupName, manager, pending, setPending, items, reloadItems, showMsg }) {
  const [q, setQ] = useState(''); // 집기 검색어

  // 이미 이 팝업으로 나가있는 집기 (저장 후)
  const allocRows = useMemo(() => {
    if (!items || !popupName) return [];
    const rows = [];
    items.forEach((it) => {
      (it.outbound || []).forEach((o) => {
        if (o.popup === popupName) rows.push({ item: it, ...o });
      });
    });
    return rows;
  }, [items, popupName]);

  const pendingQtyOf = (itemId) => pending.filter((p) => p.itemId === itemId).reduce((s, p) => s + p.qty, 0);

  // 리스트 클릭 = 담기 토글 (한 번 더 클릭하면 취소)
  function toggleItem(it, avail) {
    const exists = pending.some((p) => p.itemId === it.id);
    if (exists) {
      setPending((prev) => prev.filter((p) => p.itemId !== it.id));
      return;
    }
    if (avail <= 0) return;
    setPending((prev) => [...prev, { itemId: it.id, name: it.name, thumbnail: it.thumbnail, qty: 1, staff: '' }]);
  }

  function setPendingQty(itemId, nextQty, maxQty) {
    const qn = Math.min(Math.max(1, parseInt(nextQty) || 1), maxQty);
    setPending((prev) => prev.map((p) => (p.itemId === itemId ? { ...p, qty: qn } : p)));
  }

  async function returnEquip(row) {
    if (!confirm(`"${row.item.name}" ${row.qty}개를 반납 처리할까요? (재고 +${row.qty})`)) return;
    const res = await fetch(`/api/items/${row.item.id}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: '입고', qty: row.qty, staff: manager || '', popup: popupName }),
    });
    const json = await res.json();
    if (!res.ok) { showMsg(json.error || '반납 실패'); return; }
    showMsg(`"${row.item.name}" ${row.qty}개 반납 (재고 +${row.qty})`, true);
    await reloadItems();
    broadcast();
  }

  const totalOut = allocRows.reduce((s, r) => s + r.qty, 0);
  const totalPending = pending.reduce((s, p) => s + p.qty, 0);

  return (
    <>
      <div className="divider" />
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>사용 집기 추가</h2>
      <p className="winpop-sub">
        리스트에서 집기를 클릭하면 1개씩 담기고, 한 번 더 클릭하면 취소돼요. 수량은 아래 담긴 목록에서 조절하고, 팝업을 저장하면 그만큼 재고에서 차감(−)됩니다.
      </p>

      {!items ? (
        <p className="winpop-sub">집기리스트 불러오는 중...</p>
      ) : (
        <>
          {/* 집기 검색 + 클릭 토글 리스트 */}
          <div className="field" style={{ marginBottom: 10 }}>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 집기 검색 — 이름·컬러·사이즈·카테고리" style={{ marginBottom: 8 }} />
            {(() => {
              const kw = q.trim().toLowerCase();
              const list = items.filter((it) => {
                if (!kw) return true;
                return `${it.name} ${it.color || ''} ${it.size || ''} ${it.category || ''}`.toLowerCase().includes(kw);
              });
              return (
                <div className="equip-list">
                  {!list.length ? (
                    <div style={{ padding: '18px 12px', fontSize: 12.5, color: 'var(--ink-muted-48)', textAlign: 'center' }}>
                      검색 결과가 없어요
                    </div>
                  ) : list.map((it) => {
                    const inCart = pending.some((p) => p.itemId === it.id);
                    const avail = (it.totalStock || 0) - outQtyOf(it) - pendingQtyOf(it.id);
                    const disabled = !inCart && avail <= 0;
                    return (
                      <div key={it.id}
                        className={`equip-row ${inCart ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                        onClick={() => toggleItem(it, avail)}>
                        <div className="equip-check">{inCart ? '✓' : ''}</div>
                        <div className="equip-thumb">
                          {it.thumbnail ? <img src={it.thumbnail} alt="" loading="lazy" /> : <span>없음</span>}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="equip-name">{it.name}</div>
                          <div className="equip-meta">
                            {it.category || '미분류'}
                            {it.color ? ` · ${it.color}` : ''}
                            {it.size ? ` · ${it.size}` : ''}
                          </div>
                        </div>
                        <div className="equip-stock">
                          {disabled
                            ? <span className="badge badge-red">재고 없음</span>
                            : inCart
                              ? <span className="badge badge-blue">담김</span>
                              : <><b style={{ color: 'var(--primary)' }}>{avail}</b><span style={{ color: 'var(--ink-muted-48)' }}> / {it.totalStock || 0}</span></>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* 담긴 집기 목록 — 여기서 수량 세부 설정 */}
          <div className="cart-box">
            <div className="cart-head">
              <b>담긴 집기 {pending.length ? `${pending.length}종 · 총 ${totalPending}개` : ''}</b>
              {pending.length > 0 && (
                <button className="alloc-return-btn" onClick={() => setPending([])}>전체 비우기</button>
              )}
            </div>
            {!pending.length ? (
              <p style={{ fontSize: 12.5, color: 'var(--ink-muted-48)', textAlign: 'center', padding: '14px 0', margin: 0 }}>
                위 리스트에서 집기를 클릭하면 여기에 담겨요
              </p>
            ) : pending.map((row) => {
              const it = items.find((x) => x.id === row.itemId);
              const maxQty = it ? (it.totalStock || 0) - outQtyOf(it) : row.qty;
              return (
                <div className="cart-row" key={row.itemId}>
                  <div className="equip-thumb" style={{ width: 38, height: 38 }}>
                    {row.thumbnail ? <img src={row.thumbnail} alt="" /> : <span>없음</span>}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="equip-name">{row.name}</div>
                    <div className="equip-meta">가용 {maxQty}개 중</div>
                  </div>
                  <div className="qty-stepper">
                    <button onClick={() => setPendingQty(row.itemId, row.qty - 1, maxQty)} disabled={row.qty <= 1}>−</button>
                    <input type="number" min="1" max={maxQty} value={row.qty}
                      onChange={(e) => setPendingQty(row.itemId, e.target.value, maxQty)} />
                    <button onClick={() => setPendingQty(row.itemId, row.qty + 1, maxQty)} disabled={row.qty >= maxQty}>+</button>
                  </div>
                  <button className="cart-x" title="빼기"
                    onClick={() => setPending((prev) => prev.filter((p) => p.itemId !== row.itemId))}>✕</button>
                </div>
              );
            })}
            {pending.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600, margin: '10px 0 0' }}>
                {popupId ? '"수정 저장"을 누르면 담긴 집기가 출고 처리됩니다.' : '"팝업 추가"를 누르면 담긴 집기가 함께 출고 처리됩니다.'}
              </p>
            )}
          </div>

          {/* 저장 후 현재 사용중 집기 (반납 = ✕) */}
          {popupId && allocRows.length > 0 && (
            <div className="cart-box" style={{ marginTop: 12 }}>
              <div className="cart-head">
                <b>현재 사용중 집기 {allocRows.length}종 · 총 {totalOut}개</b>
              </div>
              {allocRows.map((row) => (
                <div className="cart-row" key={row.item.id}>
                  <div className="equip-thumb" style={{ width: 38, height: 38 }}>
                    {row.item.thumbnail ? <img src={row.item.thumbnail} alt="" /> : <span>없음</span>}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="equip-name">{row.item.name}</div>
                    <div className="equip-meta">{row.qty}개 출고중{row.date ? ` · ${row.date}` : ''}</div>
                  </div>
                  <button className="alloc-return-btn" onClick={() => returnEquip(row)}>반납 (+{row.qty})</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ===== 팝업 폼 ===== */
function PopupForm() {
  const params = useSearchParams();
  const queryId = params.get('id');

  const [savedId, setSavedId] = useState(queryId || null);
  const [savedName, setSavedName] = useState('');
  const [form, setForm] = useState({ name: '', place: '', manager: '', status: '진행중', start: '', end: '' });
  const [mode, setMode] = useState('store'); // 'store' | 'direct'
  const [stores, setStores] = useState([]);
  const [pending, setPending] = useState([]); // 저장 전 담아둔 집기
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(!!queryId);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(false);

  const showMsg = useCallback((m, ok = false) => { setMsg(m); setMsgOk(ok); }, []);

  const reloadItems = useCallback(async () => {
    const list = await fetch('/api/items').then((r) => r.json()).catch(() => null);
    if (Array.isArray(list)) setItems(list);
  }, []);

  useEffect(() => {
    reloadItems();
    fetch('/api/stores').then((r) => r.json()).then((s) => Array.isArray(s) && setStores(s)).catch(() => {});
  }, [reloadItems]);

  useEffect(() => {
    if (!queryId) return;
    fetch(`/api/popups/${queryId}`)
      .then((r) => r.json())
      .then((p) => {
        if (p.error) { showMsg(p.error); return; }
        setForm({ name: p.name || '', place: p.place || '', manager: p.manager || '', status: p.status || '진행중', start: p.start || '', end: p.end || '' });
        setSavedName(p.name || '');
        setMode('direct');
      })
      .finally(() => setLoading(false));
  }, [queryId, showMsg]);

  // 수정 진입 시 행사명이 매장 목록과 일치하면 매장 선택 모드로
  useEffect(() => {
    if (queryId && stores.length && form.name && stores.some((s) => s.name === form.name)) setMode('store');
  }, [stores, queryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function onStoreSelect(e) {
    const store = stores.find((s) => s.name === e.target.value);
    if (!store) { setForm((f) => ({ ...f, name: '' })); return; }
    // 매장 선택 시 행사명 + 주소 자동 입력 (주소는 이후 자유롭게 수정 가능)
    setForm((f) => ({ ...f, name: store.name, place: store.address }));
  }

  async function save() {
    if (!form.name.trim()) { showMsg(mode === 'store' ? '매장을 선택해주세요' : '행사명을 입력해주세요'); return; }
    if (form.start && form.end && form.end < form.start) { showMsg('종료일이 시작일보다 빠릅니다'); return; }
    setSaving(true);
    setMsg('');
    const isEdit = !!savedId;
    try {
      const res = await fetch(isEdit ? `/api/popups/${savedId}` : '/api/popups', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '저장 실패');

      // 담아둔 집기 일괄 출고
      let okCnt = 0;
      const fails = [];
      for (const row of pending) {
        const txRes = await fetch(`/api/items/${row.itemId}/tx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: '출고', qty: row.qty, staff: json.manager || form.manager || '', popup: json.name }),
        });
        if (txRes.ok) okCnt++;
        else fails.push(row.name);
      }

      setSavedId(json.id);
      setSavedName(json.name);
      setPending([]);
      await reloadItems();
      broadcast();

      let m = isEdit ? '수정되었습니다.' : '팝업이 추가되었습니다.';
      if (okCnt) m += ` 집기 ${okCnt}건 출고 처리됨.`;
      if (fails.length) m += ` (실패: ${fails.join(', ')})`;
      showMsg(m, fails.length === 0);
    } catch (e) {
      showMsg(e.message || '저장 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="winpop-sub">불러오는 중...</p>;

  return (
    <>
      {/* 행사명: 매장 선택 / 직접 입력 */}
      <div className="field">
        <label>행사명 입력 방식</label>
        <div className="action-tabs" style={{ marginBottom: 10 }}>
          <div className={`action-tab ${mode === 'store' ? 'active-in' : ''}`} onClick={() => setMode('store')}>🏬 매장 선택</div>
          <div className={`action-tab ${mode === 'direct' ? 'active-out' : ''}`} onClick={() => setMode('direct')}>✏️ 직접 등록</div>
        </div>
        {mode === 'store' ? (
          <select value={stores.some((s) => s.name === form.name) ? form.name : ''} onChange={onStoreSelect}>
            <option value="">— 매장을 선택하세요 ({stores.length}개) —</option>
            {stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        ) : (
          <input type="text" value={form.name} onChange={set('name')} placeholder="예: 현대백화점 무역센터점 팝업" autoFocus />
        )}
      </div>

      <div className="field">
        <label>장소 · 주소 {mode === 'store' ? '(매장 선택 시 자동 입력 — 수정 가능)' : ''}</label>
        <input type="text" value={form.place} onChange={set('place')} placeholder="예: 서울 강남구 테헤란로 517" />
      </div>

      <div className="row2">
        <div className="field">
          <label>담당 직원</label>
          <input type="text" value={form.manager} onChange={set('manager')} placeholder="예: 요기코" />
        </div>
        <div className="field">
          <label>상태</label>
          <select value={form.status} onChange={set('status')}>
            <option>예정</option><option>진행중</option><option>종료</option><option>회수완료</option>
          </select>
        </div>
      </div>
      <div className="row2">
        <div className="field"><label>시작일</label><input type="date" value={form.start} onChange={set('start')} /></div>
        <div className="field"><label>종료일</label><input type="date" value={form.end} onChange={set('end')} /></div>
      </div>
      <p className="winpop-sub" style={{ marginTop: 0 }}>
        세팅(출고)일은 시작일 하루 전, 철수(회수)일은 종료일 기준으로 캘린더에 표시됩니다.
      </p>

      {msg && (
        <p style={{ fontSize: 13, fontWeight: 600, color: msgOk ? 'var(--green)' : 'var(--red)', background: msgOk ? 'var(--green-bg)' : 'var(--red-bg)', padding: '9px 12px', borderRadius: 8 }}>
          {msg}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving} onClick={save}>
          {saving ? '저장 중...'
            : savedId ? (pending.length ? `수정 저장 + 집기 ${pending.length}종 출고` : '수정 저장')
            : pending.length ? `+ 팝업 추가 + 집기 ${pending.length}종 출고` : '+ 팝업 추가'}
        </button>
        <button className="btn btn-ghost" onClick={() => window.close()}>닫기</button>
      </div>

      <EquipSection
        popupId={savedId}
        popupName={savedName}
        manager={form.manager}
        pending={pending}
        setPending={setPending}
        items={items}
        reloadItems={reloadItems}
        showMsg={showMsg}
      />
    </>
  );
}

export default function PopupWindowPage() {
  const [isEditTitle, setIsEditTitle] = useState(false);
  useEffect(() => {
    document.body.classList.add('winpop');
    setIsEditTitle(new URLSearchParams(window.location.search).has('id'));
    return () => document.body.classList.remove('winpop');
  }, []);

  return (
    <div className="winpop-wrap">
      <h1><img src={LOGO} alt="YOGIBO" />{isEditTitle ? '팝업 정보 수정' : '팝업 추가'}</h1>
      <p className="winpop-sub">저장하면 메인 화면에 바로 반영됩니다.</p>
      <Suspense fallback={<p className="winpop-sub">불러오는 중...</p>}>
        <PopupForm />
      </Suspense>
    </div>
  );
}
