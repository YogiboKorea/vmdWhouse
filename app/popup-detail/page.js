'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const LOGO = 'https://yogibo.kr/web/img/icon/logo3_on.png';
const STATUS_BADGE = { 예정: 'gray', 진행중: 'green', 종료: 'amber', 회수완료: 'blue' };

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function displayStatus(p) {
  if (p.status === '회수완료') return '회수완료';
  if (p.end && p.end < todayStr()) return '종료';
  return p.status || '진행중';
}

function DetailBody() {
  const params = useSearchParams();
  const id = params.get('id');
  const [popup, setPopup] = useState(null);
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [checked, setChecked] = useState(() => new Set()); // 회수 확인 체크된 품목 id
  const [modes, setModes] = useState({}); // itemId → '회수' | '폐기'
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [p, i] = await Promise.all([
      fetch(`/api/popups/${id}`).then((r) => r.json()),
      fetch('/api/items').then((r) => r.json()),
    ]);
    if (p.error) { setErr(p.error); return; }
    setPopup(p);
    if (Array.isArray(i)) setItems(i);
  }, [id]);

  useEffect(() => {
    load();
    const bc = new BroadcastChannel('vmd-sync');
    bc.onmessage = () => load();
    return () => bc.close();
  }, [load]);

  const allocRows = useMemo(() => {
    if (!items || !popup) return [];
    const rows = [];
    items.forEach((it) => {
      (it.outbound || []).forEach((o) => {
        if (o.popup === popup.name) rows.push({ item: it, ...o });
      });
    });
    return rows;
  }, [items, popup]);

  if (err) return <p style={{ color: 'var(--red)', fontSize: 13 }}>{err}</p>;
  if (!popup || !items) return <p className="winpop-sub">불러오는 중...</p>;

  const st = displayStatus(popup);
  const totalQty = allocRows.reduce((s, r) => s + r.qty, 0);
  const setupDate = popup.start ? addDays(popup.start, -1) : '';

  const checkedRows = allocRows.filter((r) => checked.has(r.item.id));
  const checkedQty = checkedRows.reduce((s, r) => s + r.qty, 0);
  const modeOf = (itemId) => modes[itemId] || '회수';
  const returnRows = checkedRows.filter((r) => modeOf(r.item.id) === '회수');
  const disposeRows = checkedRows.filter((r) => modeOf(r.item.id) === '폐기');

  function toggleCheck(itemId) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function setMode(itemId, mode) {
    setModes((prev) => ({ ...prev, [itemId]: mode }));
    setChecked((prev) => new Set(prev).add(itemId)); // 모드 선택 시 자동 체크
  }

  function notifyChanged() {
    const bc = new BroadcastChannel('vmd-sync');
    bc.postMessage('changed');
    bc.close();
  }

  // 체크한 집기를 선택한 방식대로 처리 (재고 복귀 / 폐기) — 모두 처리되면 팝업을 회수완료로 마감
  async function retrieveChecked() {
    if (!checkedRows.length) return;
    const parts = [];
    if (returnRows.length) parts.push(`재고 복귀 ${returnRows.length}종 ${returnRows.reduce((s, r) => s + r.qty, 0)}개`);
    if (disposeRows.length) parts.push(`폐기 ${disposeRows.length}종 ${disposeRows.reduce((s, r) => s + r.qty, 0)}개`);
    const warn = disposeRows.length ? '\n⚠️ 폐기된 수량은 보유 재고에서 완전히 제외됩니다.' : '';
    if (!confirm(`체크한 집기를 처리할까요?\n${parts.join(' · ')}${warn}`)) return;
    setProcessing(true);
    const fails = [];
    for (const row of checkedRows) {
      const type = modeOf(row.item.id) === '폐기' ? '폐기' : '입고';
      const res = await fetch(`/api/items/${row.item.id}/tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, qty: row.qty, staff: '회수확인', popup: popup.name }),
      });
      if (!res.ok) fails.push(row.item.name);
    }
    // 남은 출고가 없으면 팝업 자체를 회수완료로 마감
    const remaining = allocRows.length - (checkedRows.length - fails.length);
    if (remaining <= 0 && st !== '회수완료') {
      await fetch(`/api/popups/${popup.id}/retrieve`, { method: 'POST' });
    }
    setChecked(new Set());
    setModes({});
    setProcessing(false);
    notifyChanged();
    await load();
    if (fails.length) alert(`일부 실패: ${fails.join(', ')}`);
    else if (remaining <= 0) alert('모든 집기 처리 완료 — 팝업이 회수완료 처리되었습니다.');
  }

  async function retrieve() {
    if (!confirm(`"${popup.name}" 전체 회수 완료 처리할까요?\n출고중인 ${totalQty}개 집기가 모두 물류센터 재고로 복귀합니다.\n(집기를 하나씩 확인하려면 리스트를 클릭해 체크 후 "체크한 집기 회수"를 이용하세요)`)) return;
    const res = await fetch(`/api/popups/${popup.id}/retrieve`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) { alert(json.error || '회수 처리 실패'); return; }
    setChecked(new Set());
    notifyChanged();
    load();
  }

  return (
    <>
      {/* 팝업 기본 정보 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0, letterSpacing: '-0.3px' }}>{popup.name}</h2>
        <span className={`badge badge-${STATUS_BADGE[st] || 'gray'}`}>{st}</span>
      </div>
      {(popup.place || popup.manager) && (
        <p className="winpop-sub" style={{ marginBottom: 16 }}>
          {popup.place ? `📍 ${popup.place}` : ''}{popup.place && popup.manager ? '  ·  ' : ''}{popup.manager ? `👤 담당 ${popup.manager}` : ''}
        </p>
      )}

      {/* 일정 */}
      <div style={{ background: 'var(--pearl)', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted-48)', marginBottom: 8 }}>일정</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted-48)' }}>세팅(출고)</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{setupDate || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted-48)' }}>진행 기간</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              {popup.start ? `${popup.start} ~ ${popup.end || ''}` : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted-48)' }}>철수(회수)</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: st === '종료' ? 'var(--red)' : 'var(--ink)' }}>
              {popup.end || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* 사용 집기 리스트 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>사용중 집기 — 회수 체크리스트</b>
        <span style={{ fontSize: 12, color: 'var(--ink-muted-48)' }}>
          {allocRows.length ? `체크 ${checkedRows.length}/${allocRows.length}종 · 총 ${totalQty}개` : ''}
        </span>
      </div>
      {allocRows.length > 0 && (
        <p className="winpop-sub" style={{ marginBottom: 8 }}>
          집기를 하나씩 확인하면서 클릭해 체크하세요. 체크한 집기만 골라서 회수 처리할 수 있어요.
        </p>
      )}
      {!allocRows.length ? (
        <p style={{ fontSize: 13, color: 'var(--ink-muted-48)', background: 'var(--pearl)', padding: '14px 12px', borderRadius: 10, textAlign: 'center' }}>
          이 팝업으로 출고중인 집기가 없어요
        </p>
      ) : (
        <div style={{ border: '1px solid var(--divider-soft)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
          {allocRows.map((row, i) => {
            const isChecked = checked.has(row.item.id);
            const mode = modeOf(row.item.id);
            const isDispose = isChecked && mode === '폐기';
            const accent = isDispose ? 'var(--red)' : 'var(--green)';
            const accentBg = isDispose ? 'var(--red-bg)' : 'var(--green-bg)';
            return (
              <div key={row.item.id} onClick={() => toggleCheck(row.item.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                background: isChecked ? accentBg : 'transparent',
                borderBottom: i < allocRows.length - 1 ? '1px solid var(--divider-soft)' : 'none',
              }}>
                <div className="equip-check" style={isChecked ? { background: accent, borderColor: accent } : {}}>
                  {isChecked ? (isDispose ? '✕' : '✓') : ''}
                </div>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--pearl)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, fontSize: 10, color: 'var(--ink-muted-48)' }}>
                  {row.item.thumbnail ? <img src={row.item.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : '없음'}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.item.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted-48)', marginTop: 1 }}>
                    {row.item.category || '미분류'}
                    {row.date ? ` · 출고 ${row.date}` : ''}
                    {row.staff ? ` · ${row.staff}` : ''}
                  </div>
                </div>
                {/* 처리 방식 선택: 재고 복귀 / 폐기 */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  <button className="mode-chip" style={isChecked && mode === '회수' ? { background: 'var(--green)', borderColor: 'var(--green)', color: '#fff' } : {}}
                    onClick={() => setMode(row.item.id, '회수')}>재고 복귀</button>
                  <button className="mode-chip" style={isDispose ? { background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' } : {}}
                    onClick={() => setMode(row.item.id, '폐기')}>폐기</button>
                </div>
                <b style={{ fontSize: 14, whiteSpace: 'nowrap', color: isChecked ? accent : 'var(--ink)' }}>{row.qty}개</b>
              </div>
            );
          })}
        </div>
      )}

      {allocRows.length > 0 && (
        <button className="btn btn-primary" disabled={!checkedRows.length || processing}
          style={{ width: '100%', marginTop: 12, background: checkedRows.length ? (disposeRows.length && !returnRows.length ? 'var(--red)' : 'var(--green)') : undefined }}
          onClick={retrieveChecked}>
          {processing ? '처리 중...'
            : !checkedRows.length ? '집기를 클릭해 체크하세요'
            : `✓ 체크한 집기 처리${returnRows.length ? ` · 복귀 ${returnRows.length}종 +${returnRows.reduce((s, r) => s + r.qty, 0)}개` : ''}${disposeRows.length ? ` · 폐기 ${disposeRows.length}종 −${disposeRows.reduce((s, r) => s + r.qty, 0)}개` : ''}`}
        </button>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {st !== '회수완료' && allocRows.length > 0 && (
          <button className="btn btn-ghost" style={{ flex: 1, color: 'var(--green)', borderColor: 'var(--green)' }} onClick={retrieve}>
            전체 회수 (+{totalQty})
          </button>
        )}
        <button className="btn btn-ghost" style={{ flex: 1 }}
          onClick={() => { window.location.href = `/popup?id=${popup.id}`; }}>
          수정 · 집기 추가
        </button>
        <button className="btn btn-ghost" onClick={() => window.close()}>닫기</button>
      </div>
    </>
  );
}

export default function PopupDetailPage() {
  useEffect(() => {
    document.body.classList.add('winpop');
    return () => document.body.classList.remove('winpop');
  }, []);

  return (
    <div className="winpop-wrap">
      <h1><img src={LOGO} alt="YOGIBO" />팝업 상세</h1>
      <p className="winpop-sub">일정과 사용중인 집기 현황입니다.</p>
      <Suspense fallback={<p className="winpop-sub">불러오는 중...</p>}>
        <DetailBody />
      </Suspense>
    </div>
  );
}
