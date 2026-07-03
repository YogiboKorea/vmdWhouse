'use client';

// 채도 높은 구분되는 컬러 팔레트 — 팝업 순서대로 돌아가며 배정
const CAL_PALETTE = [
  { bg: '#dbeafe', text: '#1d4ed8' }, // 파랑
  { bg: '#ffedd5', text: '#c2410c' }, // 주황
  { bg: '#dcfce7', text: '#15803d' }, // 초록
  { bg: '#fce7f3', text: '#be185d' }, // 핑크
  { bg: '#ede9fe', text: '#6d28d9' }, // 보라
  { bg: '#ccfbf1', text: '#0f766e' }, // 청록
  { bg: '#fee2e2', text: '#b91c1c' }, // 빨강
  { bg: '#fef9c3', text: '#a16207' }, // 노랑
  { bg: '#e0e7ff', text: '#4338ca' }, // 남색
  { bg: '#ecfccb', text: '#4d7c0f' }, // 라임
];

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmt(d);
}

const MAX_LANES = 3;
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function Calendar({ popups, cursor, onShift, onToday, onBarClick }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // 팝업 등록 순서대로 팔레트 배정 (해시 충돌로 비슷한 색이 나오는 것 방지)
  const colorMap = {};
  popups.forEach((p, i) => { colorMap[p.name] = CAL_PALETTE[i % CAL_PALETTE.length]; });
  const colorFor = (name) => colorMap[name] || CAL_PALETTE[0];

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const todayStr = fmt(new Date());

  const allDates = [];
  for (let i = 0; i < totalCells; i++) {
    let d, outside = false;
    if (i < startOffset) { d = new Date(year, month - 1, daysInPrevMonth - startOffset + i + 1); outside = true; }
    else if (i >= startOffset + daysInMonth) { d = new Date(year, month + 1, i - startOffset - daysInMonth + 1); outside = true; }
    else { d = new Date(year, month, i - startOffset + 1); }
    allDates.push({ date: d, str: fmt(d), outside });
  }

  const eventsWithDates = popups
    .filter((p) => p.start && p.end)
    .map((p) => ({ ...p, setupDate: addDays(p.start, -1) }));

  const weeks = [];
  for (let w = 0; w < allDates.length; w += 7) {
    const weekDates = allDates.slice(w, w + 7);
    const weekStartStr = weekDates[0].str;
    const weekEndStr = weekDates[6].str;

    const weekEvents = eventsWithDates
      .filter((p) => p.setupDate <= weekEndStr && p.end >= weekStartStr)
      .map((p) => {
        const visStart = p.setupDate > weekStartStr ? p.setupDate : weekStartStr;
        const visEnd = p.end < weekEndStr ? p.end : weekEndStr;
        return {
          popup: p,
          colStart: weekDates.findIndex((wd) => wd.str === visStart),
          colEnd: weekDates.findIndex((wd) => wd.str === visEnd),
          contLeft: p.setupDate < weekStartStr,
          contRight: p.end > weekEndStr,
          isTeardownHere: p.end <= weekEndStr,
          setupColInWeek: weekDates.findIndex((wd) => wd.str === p.setupDate),
        };
      })
      .sort((a, b) => a.colStart - b.colStart || (b.colEnd - b.colStart) - (a.colEnd - a.colStart));

    const laneEnds = [];
    let overflow = 0;
    weekEvents.forEach((ev) => {
      let lane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] < ev.colStart) { lane = i; break; }
      }
      if (lane === -1) lane = laneEnds.length;
      if (lane >= MAX_LANES) { ev.lane = -1; overflow++; }
      else { ev.lane = lane; laneEnds[lane] = ev.colEnd; }
    });

    const lanesUsed = Math.min(MAX_LANES, Math.max(1, laneEnds.length));
    weeks.push({ weekDates, weekEvents, overflow, lanesUsed });
  }

  const withDates = popups.filter((p) => p.start && p.end);

  return (
    <div className="cal-card">
      <div className="cal-header">
        <div className="cal-nav">
          <button className="btn-icon" onClick={() => onShift(-1)}>‹</button>
          <span className="cal-month-label">{year}년 {month + 1}월</span>
          <button className="btn-icon" onClick={() => onShift(1)}>›</button>
        </div>
        <button className="btn btn-ghost" onClick={onToday}>오늘</button>
      </div>

      <div className="cal-daynames">
        {DAY_NAMES.map((d, i) => (
          <div key={d} className={`cal-dayname ${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}`}>{d}</div>
        ))}
      </div>

      <div className="cal-weeks">
        {weeks.map(({ weekDates, weekEvents, overflow, lanesUsed }, wi) => {
          const rowTemplate = `28px repeat(${lanesUsed}, 24px)` + (overflow > 0 ? ' 16px' : '');
          return (
            <div key={wi} className="cal-week" style={{ gridTemplateRows: rowTemplate }}>
              {weekDates.map((wd, i) => (
                <div key={`bg${i}`} className={`cal-daybg ${wd.outside ? 'outside' : ''}`}
                  style={{ gridColumn: i + 1, gridRow: '1/-1' }} />
              ))}
              {weekDates.map((wd, i) => (
                <div key={`num${i}`}
                  className={`cal-daynum-cell ${wd.outside ? 'outside' : ''} ${wd.str === todayStr ? 'today' : ''}`}
                  style={{ gridColumn: i + 1, gridRow: 1 }}>
                  <span>{wd.date.getDate()}</span>
                </div>
              ))}
              {weekEvents.filter((ev) => ev.lane >= 0).map((ev, ei) => {
                const c = colorFor(ev.popup.name);
                const hasSetupDayHere = ev.setupColInWeek === ev.colStart && ev.setupColInWeek >= 0;
                if (hasSetupDayHere && ev.colEnd > ev.colStart) {
                  const mainCls = 'cont-left' + (ev.contRight ? ' cont-right' : '');
                  const label = ev.popup.name + (ev.isTeardownHere ? ' · 철수' : '');
                  return [
                    <div key={`s${ei}`} className="cal-bar setup cont-right"
                      style={{ gridColumn: `${ev.colStart + 1} / ${ev.colStart + 2}`, gridRow: ev.lane + 2, background: c.bg, color: c.text }}
                      title={`세팅일(출고일): ${ev.popup.setupDate}`}>세팅</div>,
                    <div key={`m${ei}`} className={`cal-bar ${mainCls}`}
                      style={{ gridColumn: `${ev.colStart + 2} / ${ev.colEnd + 2}`, gridRow: ev.lane + 2, background: c.bg, color: c.text, boxShadow: `inset 3px 0 0 ${c.text}` }}
                      title={`${ev.popup.name} (진행 ${ev.popup.start} ~ ${ev.popup.end}, 철수 ${ev.popup.end})`}
                      onClick={() => onBarClick(ev.popup)}>{label}</div>,
                  ];
                }
                const cls = (ev.contLeft ? 'cont-left ' : '') + (ev.contRight ? 'cont-right' : '');
                const isPureSetupDay = hasSetupDayHere && ev.colEnd === ev.colStart;
                const label = isPureSetupDay ? '세팅' : ev.popup.name + (ev.isTeardownHere ? ' · 철수' : '');
                return (
                  <div key={ei} className={`cal-bar ${cls}${isPureSetupDay ? ' setup' : ''}`}
                    style={{ gridColumn: `${ev.colStart + 1} / ${ev.colEnd + 2}`, gridRow: ev.lane + 2, background: c.bg, color: c.text, ...(isPureSetupDay ? {} : { boxShadow: `inset 3px 0 0 ${c.text}` }) }}
                    title={`${ev.popup.name} (진행 ${ev.popup.start} ~ ${ev.popup.end}, 세팅 ${ev.popup.setupDate}, 철수 ${ev.popup.end})`}
                    onClick={() => onBarClick(ev.popup)}>{label}</div>
                );
              })}
              {overflow > 0 && (
                <div className="cal-overflow" style={{ gridRow: lanesUsed + 2 }}>+{overflow}건 더</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        {!withDates.length ? (
          <span style={{ fontSize: 12, color: 'var(--ink-muted-48)' }}>날짜가 등록된 팝업이 없어요</span>
        ) : (
          <>
            {withDates.map((p) => {
              const c = colorFor(p.name);
              return (
                <div key={p.id} className="cal-legend-item">
                  <span className="cal-legend-dot" style={{ background: c.text }} />{p.name}
                </div>
              );
            })}
            <div className="cal-legend-item" style={{ color: 'var(--ink-muted-48)' }}>
              ┊ 점선 = 세팅일(출고일, 시작일 하루 전) · &quot;· 철수&quot; = 종료일(회수일)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
