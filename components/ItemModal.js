'use client';

import { useEffect, useRef, useState } from 'react';

const CATEGORIES = ['진열집기', '가구', '모니터', 'POP', '러그', '소품', '로고', '소도구', '크리스마스', '할로윈', '어트랙션', '체험용', '소모품', '재활용배너'];
const STATUSES = ['사용가능', '파손', '수리중', '폐기'];

export { CATEGORIES };

const outQtyOf = (it) => (it?.outbound || []).reduce((s, o) => s + o.qty, 0);

// 이미지 → 최대 1000px JPEG Blob + 미리보기 dataURL
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 1000;
        const scale = Math.min(1, MAX / img.width, MAX / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        canvas.toBlob((blob) => resolve({ blob, dataUrl }), 'image/jpeg', 0.82);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function ItemModal({ item, popups, onClose, onChanged, showToast }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: '', category: CATEGORIES[0], status: '사용가능',
    color: '', size: '', note: '', totalStock: 0,
  });
  const [preview, setPreview] = useState(null);      // dataURL 미리보기
  const [pendingBlob, setPendingBlob] = useState(null);
  const [removeImage, setRemoveImage] = useState(false); // 기존 이미지 삭제(사진없음)
  const [saving, setSaving] = useState(false);

  const [txMode, setTxMode] = useState(null);        // '출고' | '입고'
  const [txQty, setTxQty] = useState(1);
  const [txStaff, setTxStaff] = useState('');
  const [txPopup, setTxPopup] = useState('');
  const [txReturn, setTxReturn] = useState('');
  const [txSaving, setTxSaving] = useState(false);
  const txFormRef = useRef(null);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name || '', category: item.category || CATEGORIES[0],
        status: item.status || '사용가능', color: item.color || '',
        size: item.size || '', note: item.note || '', totalStock: item.totalStock ?? 0,
      });
      setPreview(item.thumbnail || null);
      setRemoveImage(false);
      setPendingBlob(null);
    }
    // 새 품목은 초기값 그대로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const total = isEdit ? (item.totalStock ?? 0) : 0;
  const out = isEdit ? outQtyOf(item) : 0;
  const allocs = isEdit ? item.outbound || [] : [];

  async function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { blob, dataUrl } = await resizeImage(file);
      setPendingBlob(blob);
      setPreview(dataUrl);
      setRemoveImage(false);
    } catch {
      showToast('이미지를 읽을 수 없어요');
    }
  }

  function clearImage() {
    setPreview(null);
    setPendingBlob(null);
    setRemoveImage(true);
  }

  async function save() {
    if (!form.name.trim()) { showToast('품목명을 입력해주세요'); return; }
    setSaving(true);
    try {
      let thumbnail;
      if (pendingBlob) {
        const fd = new FormData();
        fd.append('file', pendingBlob, 'item.jpg');
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        const upJson = await up.json();
        if (!up.ok) throw new Error(upJson.error || '이미지 업로드 실패');
        thumbnail = upJson.url;
      }
      const body = { ...form, totalStock: parseInt(form.totalStock) || 0 };
      if (thumbnail !== undefined) body.thumbnail = thumbnail;
      else if (removeImage) body.thumbnail = null; // 이미지 삭제 → 사진없음
      const res = await fetch(isEdit ? `/api/items/${item.id}` : '/api/items', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '저장 실패');
      showToast('저장되었습니다');
      await onChanged();
      onClose();
    } catch (e) {
      showToast(e.message || '저장 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!isEdit) return;
    if (!confirm(`"${item.name}" 품목을 삭제할까요?\n이 작업은 되돌릴 수 없어요.`)) return;
    try {
      await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
      showToast('삭제되었습니다');
      await onChanged();
      onClose();
    } catch {
      showToast('삭제 실패 — 잠시 후 다시 시도해주세요');
    }
  }

  function openTx(mode) {
    setTxMode(mode);
    setTxQty(1);
    if (mode === '입고') {
      const first = allocs[0];
      setTxReturn(first ? first.popup : '');
      if (first) setTxQty(first.qty);
    }
  }

  function quickReturn(popupName) {
    setTxMode('입고');
    setTxReturn(popupName);
    const alloc = allocs.find((a) => a.popup === popupName);
    setTxQty(alloc ? alloc.qty : 1);
    setTimeout(() => txFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  async function submitTx() {
    if (!txMode) return;
    const popupName = txMode === '출고' ? txPopup.trim() : txReturn;
    if (!popupName) { showToast(txMode === '출고' ? '팝업 행사를 입력해주세요' : '반납할 출고 건을 선택해주세요'); return; }
    setTxSaving(true);
    try {
      const res = await fetch(`/api/items/${item.id}/tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: txMode, qty: txQty, staff: txStaff.trim(), popup: popupName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '저장 실패');
      showToast(`${txMode} 기록 저장됨`);
      setTxStaff(''); setTxPopup(''); setTxQty(1);
      await onChanged();
    } catch (e) {
      showToast(e.message || '저장 실패 — 잠시 후 다시 시도해주세요');
    } finally {
      setTxSaving(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <button className="close-x" onClick={onClose}>✕</button>
        <h2>{isEdit ? '품목 상세' : '새 품목 등록'}</h2>

        <div className="field">
          <label>이미지</label>
          <div className="upload-box">
            {preview ? <img src={preview} alt="" /> : <span className="hint">클릭해서 사진 선택 (Cafe24 FTP에 업로드됩니다)</span>}
            <input type="file" accept="image/*" onChange={handleImageSelect} />
          </div>
          {preview && (
            <button type="button" className="btn-danger-text" style={{ marginTop: 6, fontSize: 13 }} onClick={clearImage}>
              🗑 이미지 삭제 (사진없음으로)
            </button>
          )}
        </div>

        <div className="field">
          <label>품목명</label>
          <input type="text" value={form.name} onChange={set('name')} placeholder="예: KALLAX 수납장(화이트)" />
        </div>

        <div className="row2">
          <div className="field">
            <label>카테고리</label>
            <select value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>상태</label>
            <select value={form.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="row2">
          <div className="field"><label>컬러</label>
            <input type="text" value={form.color} onChange={set('color')} placeholder="예: 화이트" /></div>
          <div className="field"><label>사이즈</label>
            <input type="text" value={form.size} onChange={set('size')} placeholder="예: 800*1470" /></div>
        </div>

        <div className="field">
          <label>물류센터 총 보유수량</label>
          <input type="number" min="0" value={form.totalStock} onChange={set('totalStock')} />
        </div>

        <div className="field">
          <label>비고</label>
          <textarea rows={2} value={form.note} onChange={set('note')} placeholder="특이사항" />
        </div>

        {isEdit && (
          <>
            <div className="divider" />
            <div className="stock-summary">
              <div className="stock-box"><div className="num">{total}</div><div className="lbl">총 보유</div></div>
              <div className="stock-box out"><div className="num">{out}</div><div className="lbl">출고중</div></div>
              <div className="stock-box avail"><div className="num">{total - out}</div><div className="lbl">가용</div></div>
            </div>

            {allocs.length > 0 && (
              <div className="alloc-list">
                {allocs.map((a) => (
                  <div className="alloc-row" key={a.popup}>
                    <span><b>{a.popup}</b> · {a.qty}개 {a.staff ? `· ${a.staff}` : ''}</span>
                    <button className="alloc-return-btn" onClick={() => quickReturn(a.popup)}>반납 처리</button>
                  </div>
                ))}
              </div>
            )}

            <div className="action-tabs">
              <div className={`action-tab ${txMode === '출고' ? 'active-out' : ''}`} onClick={() => openTx('출고')}>📤 출고</div>
              <div className={`action-tab ${txMode === '입고' ? 'active-in' : ''}`} onClick={() => openTx('입고')}>📥 반납</div>
            </div>

            {txMode && (
              <div ref={txFormRef}>
                <div className="row2">
                  <div className="field">
                    <label>수량</label>
                    <input type="number" min="1" value={txQty} onChange={(e) => setTxQty(parseInt(e.target.value) || 1)} />
                  </div>
                  <div className="field">
                    <label>담당자</label>
                    <input type="text" value={txStaff} onChange={(e) => setTxStaff(e.target.value)} placeholder="이름" />
                  </div>
                </div>
                {txMode === '출고' ? (
                  <div className="field">
                    <label>팝업 행사</label>
                    <input type="text" list="popupDatalist" value={txPopup} onChange={(e) => setTxPopup(e.target.value)}
                      placeholder="팝업명 입력 또는 선택" />
                    <datalist id="popupDatalist">
                      {popups.map((p) => <option key={p.id} value={p.name} />)}
                    </datalist>
                  </div>
                ) : (
                  <div className="field">
                    <label>반납할 출고 건 선택</label>
                    <select value={txReturn} onChange={(e) => {
                      setTxReturn(e.target.value);
                      const alloc = allocs.find((a) => a.popup === e.target.value);
                      if (alloc) setTxQty(alloc.qty);
                    }}>
                      {!allocs.length && <option value="">현재 출고중인 내역이 없어요</option>}
                      {allocs.map((a) => <option key={a.popup} value={a.popup}>{a.popup} ({a.qty}개)</option>)}
                    </select>
                  </div>
                )}
                <button className="btn btn-primary" style={{ width: '100%' }} disabled={txSaving} onClick={submitTx}>
                  {txSaving ? '저장 중...' : '기록 저장'}
                </button>
              </div>
            )}

            <div className="divider" />
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted-48)' }}>최근 입출고 이력</label>
            <div className="history">
              {!(item.history || []).length ? (
                <div style={{ color: 'var(--ink-muted-48)', fontSize: 12, padding: '8px 0' }}>아직 기록 없음</div>
              ) : (
                item.history.slice().reverse().map((h, i) => (
                  <div className="history-item" key={i}>
                    <span><b>{h.type}</b> {h.qty}개 {h.popup ? `· ${h.popup}` : ''}</span>
                    <span>{h.date} {h.staff ? `· ${h.staff}` : ''}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          {isEdit && <button className="btn-danger-text" onClick={remove}>삭제</button>}
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose}>취소</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
