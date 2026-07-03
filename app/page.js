'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Calendar from '@/components/Calendar';
import ItemModal, { CATEGORIES } from '@/components/ItemModal';

const LOGO = 'https://yogibo.kr/web/img/icon/logo3_on.png';

const outQtyOf = (it) => (it.outbound || []).reduce((s, o) => s + o.qty, 0);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 종료일이 지나면 자동으로 '종료(회수 대기)' 상태로 표시
function displayStatus(p) {
  if (p.status === '회수완료') return '회수완료';
  if (p.end && p.end < todayStr()) return '종료';
  return p.status || '진행중';
}
const STATUS_BADGE = { 예정: 'gray', 진행중: 'green', 종료: 'amber', 회수완료: 'blue' };

export default function Home() {
  const [items, setItems] = useState(null);
  const [popups, setPopups] = useState(null);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('전체');
  const [outboundOnly, setOutboundOnly] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [calCursor, setCalCursor] = useState(() => new Date());
  const [dashFilter, setDashFilter] = useState(null);
  const [popupTab, setPopupTab] = useState('진행'); // '진행' | '완료'

  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const dashRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [i, p] = await Promise.all([
        fetch('/api/items').then((r) => r.json()),
        fetch('/api/popups').then((r) => r.json()),
      ]);
      if (Array.isArray(i)) setItems(i);
      if (Array.isArray(p)) setPopups(p);
    } catch (e) {
      console.error('데이터 로드 실패:', e);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 20000);
    const bc = new BroadcastChannel('vmd-sync');
    bc.onmessage = () => loadAll();
    return () => { clearInterval(t); bc.close(); };
  }, [loadAll]);

  const loaded = items !== null && popups !== null;
  const editingItem = editingId && items ? items.find((x) => x.id === editingId) : null;

  /* ---------- 팝업 window ---------- */
  function openPopupWindow(id) {
    const url = id ? `/popup?id=${id}` : '/popup';
    const left = window.screenX + window.outerWidth - 560;
    window.open(url, 'vmdPopupWin', `width=530,height=900,left=${left},top=60,resizable=yes,scrollbars=yes`);
  }

  // 달력 클릭 → 해당 팝업의 일정 + 사용 집기 리스트를 window 팝업으로
  function openDetailWindow(id) {
    const left = window.screenX + window.outerWidth - 560;
    window.open(`/popup-detail?id=${id}`, 'vmdDetailWin', `width=530,height=820,left=${left},top=60,resizable=yes,scrollbars=yes`);
  }

  /* ---------- 팝업 삭제/회수 ---------- */
  async function deletePopup(p) {
    const linkedQty = (items || []).reduce(
      (s, it) => s + (it.outbound || []).filter((o) => o.popup === p.name).reduce((a, o) => a + o.qty, 0), 0);
    const msg = linkedQty > 0
      ? `"${p.name}"으로 현재 출고중인 수량이 ${linkedQty}개 있어요. 그래도 팝업 정보만 삭제할까요?\n(품목의 출고 기록은 그대로 남아요)`
      : `"${p.name}" 팝업을 삭제할까요?`;
    if (!confirm(msg)) return;
    await fetch(`/api/popups/${p.id}`, { method: 'DELETE' });
    showToast('팝업이 삭제되었습니다');
    loadAll();
  }

  async function retrievePopup(p) {
    const linkedQty = (items || []).reduce(
      (s, it) => s + (it.outbound || []).filter((o) => o.popup === p.name).reduce((a, o) => a + o.qty, 0), 0);
    if (!confirm(`"${p.name}" 회수 완료 처리할까요?\n출고중인 ${linkedQty}개 집기가 모두 물류센터 재고로 복귀합니다.`)) return;
    const res = await fetch(`/api/popups/${p.id}/retrieve`, { method: 'POST' });
    const json = await res.json();
    if (!res.ok) { showToast(json.error || '회수 처리 실패'); return; }
    showToast(`회수 완료 — ${json.returnedItems}개 품목 · ${json.returnedQty}개 재고 복귀`);
    loadAll();
  }

  /* ---------- 집기리스트 필터 + 정렬 + 페이지네이션 (페이지당 20개) ---------- */
  const PAGE_SIZE = 20;
  const [itemPage, setItemPage] = useState(1);
  const [zeroOnly, setZeroOnly] = useState(false); // 재고 미입력(0)만
  const [sortKey, setSortKey] = useState('recent'); // recent | name | avail | out

  // 전체 재고 요약 (필터와 무관)
  const stats = useMemo(() => {
    const list = items || [];
    return {
      count: list.length,
      stock: list.reduce((s, it) => s + (it.totalStock || 0), 0),
      out: list.reduce((s, it) => s + outQtyOf(it), 0),
      zero: list.filter((it) => (it.totalStock || 0) === 0).length,
    };
  }, [items]);

  // 카테고리별 품목 수
  const catCounts = useMemo(() => {
    const m = {};
    (items || []).forEach((it) => { m[it.category] = (m[it.category] || 0) + 1; });
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (items || []).filter((it) => {
      if (activeCategory !== '전체' && it.category !== activeCategory) return false;
      if (outboundOnly && outQtyOf(it) <= 0) return false;
      if (zeroOnly && (it.totalStock || 0) !== 0) return false;
      if (q) {
        const hay = `${it.name} ${it.color || ''} ${it.size || ''} ${it.note || ''} ${it.category || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sorters = {
      recent: null, // API가 최근 등록순으로 반환
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
      avail: (a, b) => ((b.totalStock || 0) - outQtyOf(b)) - ((a.totalStock || 0) - outQtyOf(a)),
      out: (a, b) => outQtyOf(b) - outQtyOf(a),
    };
    return sorters[sortKey] ? [...list].sort(sorters[sortKey]) : list;
  }, [items, activeCategory, outboundOnly, zeroOnly, search, sortKey]);

  // 검색/필터가 바뀌면 1페이지로
  useEffect(() => { setItemPage(1); }, [search, activeCategory, outboundOnly, zeroOnly, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(itemPage, totalPages);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const itemsSectionRef = useRef(null);
  function goPage(n) {
    setItemPage(Math.min(Math.max(1, n), totalPages));
    itemsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- 출고 현황 ---------- */
  const dashMap = {};
  (items || []).forEach((it) => {
    (it.outbound || []).forEach((o) => {
      if (!dashMap[o.popup]) dashMap[o.popup] = [];
      dashMap[o.popup].push({
        name: it.name, qty: o.qty, staff: o.staff, date: o.date,
        thumbnail: it.thumbnail, category: it.category,
      });
    });
  });
  const popupByName = Object.fromEntries((popups || []).map((p) => [p.name, p]));
  // 종료·회수완료된 팝업은 출고 현황에서 제외 (예정·진행중만 표시)
  const allDashKeys = Object.keys(dashMap);
  let dashKeys = allDashKeys.filter((k) => {
    const p = popupByName[k];
    if (!p) return true; // 팝업 기록이 없는 출고 건은 놓치지 않게 표시 유지
    const st = displayStatus(p);
    return st === '예정' || st === '진행중';
  });
  const hiddenDash = allDashKeys.filter((k) => !dashKeys.includes(k));
  const hiddenQty = hiddenDash.reduce((s, k) => s + dashMap[k].reduce((a, r) => a + r.qty, 0), 0);
  const dashChips = ['전체', ...dashKeys];
  if (dashFilter) dashKeys = dashKeys.filter((k) => k === dashFilter);

  const statusBadge = (s) => <span className={`badge badge-${{ 사용가능: 'green', 파손: 'red', 수리중: 'amber', 폐기: 'gray' }[s] || 'gray'}`}>{s}</span>;

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <img src={LOGO} alt="YOGIBO" className="topbar-logo" />
          <span className="topbar-title">집기 입출고 관리</span>
          <span className="topbar-status">
            {loaded ? `품목 ${items.length}개 · 팝업 ${popups.length}건` : '연결 중...'}
          </span>
          <nav className="topbar-nav">
            <a href="#schedule">출고·회수 일정</a>
            <a href="#items">집기리스트</a>
            <a href="#dashboard">출고 현황</a>
          </nav>
          <button className="btn btn-primary" onClick={() => openPopupWindow()}>+ 팝업 추가</button>
        </div>
      </div>

      <div className="wrap">
        {/* ===== 출고·회수 일정 ===== */}
        <section className="section" id="schedule">
          <div className="page-head">
            <div>
              <p className="page-title">출고·회수 일정</p>
              <p className="page-sub">어떤 집기가 어디(매장·팝업)에 나가있는지, 언제쯤 물류센터로 회수되는지 확인하세요</p>
            </div>
          </div>
          <div className="schedule-cols">
            <Calendar
              popups={popups || []}
              cursor={calCursor}
              onShift={(n) => setCalCursor(new Date(calCursor.getFullYear(), calCursor.getMonth() + n, 1))}
              onToday={() => setCalCursor(new Date())}
              onBarClick={(p) => openDetailWindow(p.id)}
            />
            <div className="popup-panel">
              <div className="popup-panel-head">
                <b>팝업 목록</b>
                <button className="btn btn-ghost" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => openPopupWindow()}>+ 추가</button>
              </div>
              {(() => {
                const ongoing = (popups || []).filter((p) => displayStatus(p) !== '회수완료');
                const done = (popups || []).filter((p) => displayStatus(p) === '회수완료');
                const shown = popupTab === '진행' ? ongoing : done;
                return (
                  <>
                    <div className="action-tabs" style={{ marginBottom: 4 }}>
                      <div className={`action-tab ${popupTab === '진행' ? 'active-in' : ''}`} onClick={() => setPopupTab('진행')}>
                        진행 팝업 ({ongoing.length})
                      </div>
                      <div className={`action-tab ${popupTab === '완료' ? 'active-out' : ''}`} onClick={() => setPopupTab('완료')}>
                        완료 팝업 ({done.length})
                      </div>
                    </div>
                    {!shown.length ? (
                      <div style={{ color: 'var(--ink-muted-48)', fontSize: 13, padding: '14px 0' }}>
                        {popupTab === '진행' ? '진행중인 팝업이 없어요' : '회수 완료된 팝업이 없어요'}
                      </div>
                    ) : shown.map((p) => {
                      const st = displayStatus(p);
                      return (
                        <div className="popup-row" key={p.id}>
                          <div className="popup-row-top">
                            <div>
                              <b>{p.name}</b><br />
                              <span style={{ color: 'var(--ink-muted-48)', fontSize: 12 }}>
                                {p.place || ''} {p.start ? `· ${p.start}~${p.end || ''}` : ''}{p.manager ? ` · 담당 ${p.manager}` : ''}
                              </span>
                            </div>
                            <span className={`badge badge-${STATUS_BADGE[st] || 'gray'}`}>{st}</span>
                          </div>
                          <div className="popup-row-actions">
                            <button className="link-btn view" onClick={() => openDetailWindow(p.id)}>상세 · 집기</button>
                            <button className="link-btn edit" onClick={() => openPopupWindow(p.id)}>수정</button>
                            <button className="link-btn del" onClick={() => deletePopup(p)}>삭제</button>
                            {st !== '회수완료' && (
                              <button className="link-btn retrieve" onClick={() => retrievePopup(p)}>
                                {st === '종료' ? '✓ 회수 완료' : '회수 완료'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        </section>

        {/* ===== 집기리스트 ===== */}
        <section className="section" id="items" ref={itemsSectionRef}>
          <div className="page-head">
            <div>
              <p className="page-title">집기리스트</p>
              <p className="page-sub">물류센터 보유 집기와 재고 현황</p>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => { setEditingId(null); setModalOpen(true); }}>+ 새 품목</button>
            </div>
          </div>

          {/* 재고 요약 */}
          {loaded && (
            <div className="statrow">
              <div className="stat-card">
                <div className="stat-num">{stats.count}</div>
                <div className="stat-lbl">전체 품목</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">{stats.stock.toLocaleString()}</div>
                <div className="stat-lbl">총 보유 재고</div>
              </div>
              <div className={`stat-card clickable ${outboundOnly ? 'on' : ''}`}
                onClick={() => { setOutboundOnly(!outboundOnly); setZeroOnly(false); }}>
                <div className="stat-num" style={{ color: 'var(--amber)' }}>{stats.out.toLocaleString()}</div>
                <div className="stat-lbl">출고중 수량 {outboundOnly ? '(필터중)' : ''}</div>
              </div>
              <div className={`stat-card clickable ${zeroOnly ? 'on' : ''}`}
                onClick={() => { setZeroOnly(!zeroOnly); setOutboundOnly(false); }}>
                <div className="stat-num" style={{ color: stats.zero ? 'var(--red)' : 'var(--ink)' }}>{stats.zero}</div>
                <div className="stat-lbl">재고 미입력 품목 {zeroOnly ? '(필터중)' : ''}</div>
              </div>
            </div>
          )}

          <div className="filterbar">
            <input className="search" placeholder="품목명·컬러·사이즈·비고로 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="recent">최근 등록순</option>
              <option value="name">이름순</option>
              <option value="avail">가용 재고 많은순</option>
              <option value="out">출고 많은순</option>
            </select>
            <div className={`toggle-chip ${outboundOnly ? 'active' : ''}`} onClick={() => setOutboundOnly(!outboundOnly)}>
              출고중만
            </div>
            <div className={`toggle-chip ${zeroOnly ? 'active' : ''}`} onClick={() => setZeroOnly(!zeroOnly)}>
              재고 미입력만
            </div>
          </div>
          <div className="chiprow">
            {['전체', ...CATEGORIES.filter((c) => catCounts[c])].map((c) => (
              <div key={c} className={`chip ${c === activeCategory ? 'active' : ''}`} onClick={() => setActiveCategory(c)}>
                {c} {c === '전체' ? `(${stats.count})` : `(${catCounts[c]})`}
              </div>
            ))}
          </div>

          {!loaded ? (
            <div className="empty"><h3>연결 중...</h3></div>
          ) : !filtered.length ? (
            <div className="empty"><h3>표시할 품목이 없어요</h3><p>필터를 바꾸거나 새 품목을 등록해보세요.</p></div>
          ) : (
            <div className="grid">
              {pageItems.map((it) => {
                const total = it.totalStock || 0;
                const out = outQtyOf(it);
                const avail = total - out;
                const sub = [it.color, it.size].filter(Boolean).join(' · ');
                return (
                  <div className="card" key={it.id} onClick={() => { setEditingId(it.id); setModalOpen(true); }}>
                    <div className="thumb">
                      {it.thumbnail ? <img src={it.thumbnail} alt="" loading="lazy" /> : '사진 없음'}
                    </div>
                    <div className="card-tag-row">
                      <span className="chip-tag">{it.category || '미분류'}</span>
                      {statusBadge(it.status || '사용가능')}
                    </div>
                    <div className="card-name">{it.name}</div>
                    <div className="card-sub">{sub || ' '}</div>
                    <div className="stock-line">
                      {total === 0 ? (
                        <span className="stock-zero">재고 수량 미입력</span>
                      ) : (
                        <>
                          <span>가용 <b style={{ color: avail > 0 ? 'var(--primary)' : 'var(--red)' }}>{avail}</b></span>
                          <span className="stock-sep">/</span>
                          <span>보유 {total}</span>
                        </>
                      )}
                    </div>
                    {out > 0 && (
                      <div className="out-pill">📤 {(it.outbound || []).length}개 행사 · {out}개 출고중</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {loaded && filtered.length > 0 && (
            <div className="pagination">
              <span className="pagination-info">
                총 {filtered.length}개 · {page}/{totalPages} 페이지
              </span>
              <button className="page-btn" disabled={page <= 1} onClick={() => goPage(page - 1)}>‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
                .reduce((acc, n, idx, arr) => {
                  if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…' + n);
                  acc.push(n);
                  return acc;
                }, [])
                .map((n) =>
                  typeof n === 'string' ? (
                    <span key={n} className="page-ellipsis">…</span>
                  ) : (
                    <button key={n} className={`page-btn ${n === page ? 'active' : ''}`} onClick={() => goPage(n)}>{n}</button>
                  )
                )}
              <button className="page-btn" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>›</button>
            </div>
          )}
        </section>

        {/* ===== 출고 현황 ===== */}
        <section className="section" id="dashboard" ref={dashRef}>
          <div className="page-head">
            <div>
              <p className="page-title">출고 현황</p>
              <p className="page-sub">진행중인 팝업에 어떤 집기가 몇 개 나가있는지 확인하세요 (종료·회수완료 팝업은 표시되지 않아요)</p>
            </div>
          </div>
          {hiddenDash.length > 0 && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amber)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
              ⚠️ 종료된 팝업 {hiddenDash.length}건에 아직 회수되지 않은 집기 {hiddenQty}개가 있어요 — 팝업 목록에서 &quot;회수 완료&quot;를 눌러 재고로 복귀시켜주세요.
            </div>
          )}
          {dashChips.length > 1 && (
            <div className="dash-filter-row">
              {dashChips.map((k) => {
                const active = (k === '전체' && !dashFilter) || k === dashFilter;
                return (
                  <div key={k} className={`chip ${active ? 'active' : ''}`}
                    onClick={() => setDashFilter(k === '전체' ? null : k)}>{k}</div>
                );
              })}
            </div>
          )}
          {!dashKeys.length ? (
            <div className="empty"><h3>현재 출고중인 품목이 없어요</h3><p>모든 집기가 물류센터에 보관되어 있어요.</p></div>
          ) : (
            <div className="dash-grid">
              {dashKeys.map((popupName) => {
                const rows = dashMap[popupName];
                const totalQty = rows.reduce((s, r) => s + r.qty, 0);
                const p = popupByName[popupName];
                const st = p ? displayStatus(p) : null;
                return (
                  <div className="dash-group" key={popupName}>
                    <div className="dash-group-head">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <b>{popupName}</b>
                          {st && <span className={`badge badge-${STATUS_BADGE[st] || 'gray'}`}>{st}</span>}
                        </div>
                        {p && (p.start || p.place) && (
                          <div style={{ fontSize: 12, color: 'var(--ink-muted-48)', marginTop: 3 }}>
                            {p.start ? `${p.start} ~ ${p.end || ''}` : ''}{p.place ? ` · ${p.place}` : ''}
                          </div>
                        )}
                      </div>
                      <span style={{ whiteSpace: 'nowrap' }}>{rows.length}개 품목 · 총 {totalQty}개</span>
                    </div>
                    {rows.map((r, i) => (
                      <div className="dash-row" key={i}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span className="dash-thumb">
                            {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : ''}
                          </span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        </span>
                        <span style={{ whiteSpace: 'nowrap' }}>
                          <b style={{ color: 'var(--ink)' }}>{r.qty}개</b> {r.staff ? `· ${r.staff}` : ''} {r.date ? `· ${r.date}` : ''}
                        </span>
                      </div>
                    ))}
                    {p && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                        <button className="link-btn view" onClick={() => openDetailWindow(p.id)}>상세 · 집기</button>
                        {st !== '회수완료' && (
                          <button className="link-btn retrieve" onClick={() => retrievePopup(p)}>
                            {st === '종료' ? '✓ 회수 완료' : '회수 완료'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {modalOpen && (
        <ItemModal
          item={editingItem}
          popups={popups || []}
          onClose={() => { setModalOpen(false); setEditingId(null); }}
          onChanged={loadAll}
          showToast={showToast}
        />
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}
