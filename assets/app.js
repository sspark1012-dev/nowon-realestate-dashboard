/* 박상순부동산 · 노원구 아파트 대시보드 */
(() => {
'use strict';
const D = window.DATA, POIS = window.POIS || [], S = window.STATIC;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PY = 3.305785;
const DONGS = ['전체', '상계동', '중계동', '하계동', '공릉동', '월계동'];
const DEAL_NAME = { sale: '매매', jeonse: '전세', wolse: '월세' };
const DEAL_COLOR = { sale: '#12345a', jeonse: '#22975f', wolse: '#e08a1e' };

/* ---------- 날짜 유틸 ---------- */
const toInt = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const fromInt = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = (n) => { const s = String(n); return `${s.slice(2, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`; };
const weekKey = (n) => { const d = fromInt(n); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return toInt(d); };
const monthKey = (n) => Math.floor(n / 100);

/* ---------- 숫자 포맷 ---------- */
function won(m) {
  if (m == null || !isFinite(m)) return '-';
  m = Math.round(m);
  const e = Math.floor(m / 10000), r = m % 10000;
  if (e && r) return `${e}억 ${r.toLocaleString()}`;
  if (e) return `${e}억`;
  return `${r.toLocaleString()}만`;
}
const wonShort = (m) => (m >= 10000 ? (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억' : Math.round(m).toLocaleString() + '만');
const pct = (v, d = 1) => (v == null || !isFinite(v) ? '-' : (v > 0 ? '+' : '') + v.toFixed(d) + '%');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const pyeong = (a) => Math.round((a * 1.33) / PY); // 전용 → 공급 평형(약)
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/* ---------- 거리 ---------- */
function dist(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);
const walk = (m) => `도보 ${Math.max(1, Math.round((m * 1.25) / 67))}분`; // 직선거리×1.25 보정, 분당 67m

/* ---------- 단지 마스터 (이름 정규화로 매매/전월세 통합) ---------- */
const normName = (n) => n.replace(/\s+/g, '').replace(/아파트$/, '');
const complexes = [];
const cxByKey = new Map();
const aptToCx = D.apts.map((a) => {
  const key = `${a.d}|${normName(a.n)}`;
  let c = cxByKey.get(key);
  if (!c) {
    c = { id: complexes.length, name: a.n.replace(/아파트$/, ''), dong: a.d, jibun: a.j, road: a.r, year: a.y, lat: a.lat, lon: a.lon, g: a.g, sale: [], rent: [] };
    complexes.push(c); cxByKey.set(key, c);
  } else {
    if (!c.road && a.r) c.road = a.r;
    if (!c.year && a.y) c.year = a.y;
    if (!c.g && a.g) { c.lat = a.lat; c.lon = a.lon; c.g = 1; }
  }
  return c.id;
});
// 거래: {c, d, p, a, f}
const SALES = [], JEONSE = [], WOLSE = [];
for (const t of D.trades) {
  if (t[5]) continue; // 해제 거래 제외
  const o = { c: aptToCx[t[0]], d: t[1], p: t[2], a: t[3], f: t[4] };
  SALES.push(o); complexes[o.c].sale.push(o);
}
for (const r of D.rents) {
  const o = { c: aptToCx[r[0]], d: r[1], p: r[2], m: r[3], a: r[4], f: r[5] };
  (o.m > 0 ? WOLSE : JEONSE).push(o); complexes[o.c].rent.push(o);
}
for (const c of complexes) { c.sale.sort((a, b) => b.d - a.d); c.rent.sort((a, b) => b.d - a.d); }
const DEALS = { sale: SALES, jeonse: JEONSE, wolse: WOLSE };
const maxDate = Math.max(...SALES.map((s) => s.d), ...JEONSE.map((s) => s.d));
const minDate = Math.min(...SALES.map((s) => s.d));

/* ---------- 상태 ---------- */
const state = {
  dong: '전체', mode: 'week', from: null, to: null,
  trendType: 'sale', idxType: 'sale', deal: 'sale', rankBy: 'count',
  selected: null, listing: null, sortKey: 'saleCnt', sortAsc: false, search: '',
};
function setPreset(p) {
  const to = fromInt(maxDate);
  const from = new Date(to);
  if (p === '1m') from.setMonth(from.getMonth() - 1);
  else if (p === '3m') from.setMonth(from.getMonth() - 3);
  else if (p === '6m') from.setMonth(from.getMonth() - 6);
  else if (p === '1y') from.setFullYear(from.getFullYear() - 1);
  else { from.setTime(fromInt(minDate).getTime()); }
  from.setDate(from.getDate() + 1);
  state.from = toInt(from); state.to = toInt(to);
  $('#dFrom').value = toISO(from); $('#dTo').value = toISO(to);
  $$('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
}

/* ---------- 필터 ---------- */
const inDong = (o) => state.dong === '전체' || complexes[o.c].dong === state.dong;
const filt = (arr, from = state.from, to = state.to) => arr.filter((o) => o.d >= from && o.d <= to && inDong(o));
function prevRange() {
  const f = fromInt(state.from), t = fromInt(state.to);
  const len = Math.round((t - f) / 864e5) + 1;
  const pt = new Date(f); pt.setDate(pt.getDate() - 1);
  const pf = new Date(pt); pf.setDate(pf.getDate() - len + 1);
  return [toInt(pf), toInt(pt)];
}
// 만원/3.3㎡ (월세는 환산보증금 = 보증금 + 월세×240, 전환율 5% 가정)
const ppa = (o) => (o.p + (o.m || 0) * 240) / (o.a / PY);

/* ---------- R-ONE 헬퍼 ---------- */
function rone(key, region, item) {
  const s = D.rone?.[key]?.series?.[region];
  if (!s) return [];
  const k = item || Object.keys(s)[0];
  return (s[k] || []).filter((r) => r[2] != null);
}
// 주간 R-ONE 행 → yyyymmdd
const wkDate = (r) => +r[1].replace(/-/g, '');
const mmDate = (r) => +r[0] * 100 + 1;

/* =================== KPI =================== */
function renderKPIs() {
  const [pf, pt] = prevRange();
  const s = filt(SALES), sp = filt(SALES, pf, pt);
  const j = filt(JEONSE), jp = filt(JEONSE, pf, pt);
  const w = filt(WOLSE);
  const sPPA = avg(s.map(ppa)), spPPA = avg(sp.map(ppa));
  const jPPA = avg(j.map(ppa)), jpPPA = avg(jp.map(ppa));
  const wRent = avg(w.map((o) => o.m)), wDep = avg(w.map((o) => o.p));
  const chg = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);

  const wk = rone('wSale', 'nowon');
  const wkLast = wk[wk.length - 1], wkPrev = wk[wk.length - 2];
  const wkChg = wkLast && wkPrev ? ((wkLast[2] - wkPrev[2]) / wkPrev[2]) * 100 : null;
  const wj = rone('wJeonse', 'nowon');
  const wjChg = wj.length > 1 ? ((wj.at(-1)[2] - wj.at(-2)[2]) / wj.at(-2)[2]) * 100 : null;
  const ratio = rone('mJeonseRatio', 'nowon').at(-1);
  const unsold = rone('mUnsold', 'nowon').at(-1), unsoldSeoul = rone('mUnsold', 'seoul').at(-1);

  const k = (label, value, delta, color) => `<div class="kpi" style="--c:${color}"><div class="k-l">${label}</div><div class="k-v">${value}</div><div class="k-d">${delta}</div></div>`;
  const dLbl = state.dong === '전체' ? '노원구' : state.dong;
  $('#kpis').innerHTML = [
    k(`${dLbl} 매매 거래량`, `${s.length.toLocaleString()}<small>건</small>`, `직전 동기간 대비 <b class="${cls(chg(s.length, sp.length))}">${pct(chg(s.length, sp.length))}</b> <span title="실거래 신고기한 30일">*신고 진행중</span>`, DEAL_COLOR.sale),
    k(`매매 평균 평당가`, `${sPPA ? Math.round(sPPA).toLocaleString() : '-'}<small>만원/3.3㎡</small>`, `직전 동기간 대비 <b class="${cls(chg(sPPA, spPPA))}">${pct(chg(sPPA, spPPA))}</b>`, '#3b6fb0'),
    k(`전세 평균 평당가`, `${jPPA ? Math.round(jPPA).toLocaleString() : '-'}<small>만원/3.3㎡</small>`, `거래 ${j.length.toLocaleString()}건 · <b class="${cls(chg(jPPA, jpPPA))}">${pct(chg(jPPA, jpPPA))}</b>`, DEAL_COLOR.jeonse),
    k(`월세 평균`, `${wRent ? Math.round(wRent).toLocaleString() : '-'}<small>만원</small>`, `보증금 평균 ${wDep ? won(wDep) : '-'} · ${w.length.toLocaleString()}건`, DEAL_COLOR.wolse),
    k(`노원구 주간 매매지수`, `${wkLast ? wkLast[2].toFixed(2) : '-'}`, `${wkLast ? wkLast[1].slice(5).replace('-', '/') + ' 주' : ''} 전주比 <b class="${cls(wkChg)}">${pct(wkChg, 2)}</b> · 전세 <b class="${cls(wjChg)}">${pct(wjChg, 2)}</b>`, '#8b3a96'),
    k(`전세가율 · 미분양`, `${ratio ? ratio[2].toFixed(1) : '-'}<small>%</small>`, `노원 미분양 <b>${unsold ? unsold[2].toLocaleString() : '-'}호</b> · 서울 ${unsoldSeoul ? unsoldSeoul[2].toLocaleString() : '-'}호 (${ratio ? ratio[1] : ''})`, '#c0392b'),
  ].join('');
}

/* =================== 차트 =================== */
Chart.defaults.font.family = "'Noto Sans KR', sans-serif";
Chart.defaults.font.size = 11.5;
Chart.defaults.color = '#5f6b7d';
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.boxHeight = 12;
const charts = {};
function drawChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($('#' + id), cfg);
}
const gridOpt = { color: '#eef1f6' };

function bucketLabel(k) {
  if (state.mode === 'week') { const s = String(k); return `${s.slice(2, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`; }
  const s = String(k); return `${s.slice(2, 4)}.${s.slice(4, 6)}`;
}
function buckets() {
  const keys = [];
  const f = fromInt(state.from), t = fromInt(state.to);
  if (state.mode === 'week') {
    const d = fromInt(weekKey(state.from));
    while (d <= t) { keys.push(toInt(d)); d.setDate(d.getDate() + 7); }
  } else {
    const d = new Date(f.getFullYear(), f.getMonth(), 1);
    while (d <= t) { keys.push(d.getFullYear() * 100 + d.getMonth() + 1); d.setMonth(d.getMonth() + 1); }
  }
  return keys;
}
const bkey = (n) => (state.mode === 'week' ? weekKey(n) : monthKey(n));

function renderTrend() {
  const type = state.trendType;
  const rows = filt(DEALS[type]);
  const keys = buckets();
  const map = new Map(keys.map((k) => [k, []]));
  for (const o of rows) map.get(bkey(o.d))?.push(o);
  const cnt = keys.map((k) => map.get(k).length);
  const val = keys.map((k) => {
    const a = map.get(k);
    if (a.length < 3) return null; // 표본 부족 구간은 가격선 생략
    return Math.round(type === 'wolse' ? avg(a.map((o) => o.m)) : avg(a.map(ppa)));
  });
  $('#trendSub').textContent = `(${state.dong === '전체' ? '노원구' : state.dong} · ${state.mode === 'week' ? '주간' : '월간'})`;
  drawChart('cTrend', {
    data: {
      labels: keys.map(bucketLabel),
      datasets: [
        { type: 'line', label: type === 'wolse' ? '평균 월세(만원)' : '평균 평당가(만원/3.3㎡)', data: val, yAxisID: 'y1', borderColor: '#d6334a', backgroundColor: '#d6334a', tension: .3, pointRadius: 2.5, spanGaps: true, order: 0 },
        { type: 'bar', label: `${DEAL_NAME[type]} 거래량(건)`, data: cnt, yAxisID: 'y', backgroundColor: DEAL_COLOR[type] + 'cc', borderRadius: 4, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } },
        y: { position: 'left', grid: gridOpt, title: { display: true, text: '건' }, beginAtZero: true },
        y1: { position: 'right', grid: { display: false }, title: { display: true, text: type === 'wolse' ? '만원' : '만원/3.3㎡' } },
      },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '-' : c.raw.toLocaleString()}` } } },
    },
  });
}

// R-ONE 지수: 기간 필터 (최소 8포인트 확보)
function seriesInRange(rows, isWeek) {
  const dt = isWeek ? wkDate : mmDate;
  let from = state.from;
  if (!isWeek) from = Math.floor(state.from / 100) * 100 + 1;
  let out = rows.filter((r) => dt(r) >= from && dt(r) <= state.to);
  const minPts = 8;
  if (out.length < minPts) {
    const upto = rows.filter((r) => dt(r) <= state.to);
    out = upto.slice(-minPts);
  }
  return out;
}
const REGION_STYLE = [
  ['nowon', '노원구', '#d6334a', 3],
  ['dongbuk', '동북권', '#e08a1e', 1.6],
  ['seoul', '서울', '#12345a', 1.6],
  ['nation', '전국', '#8e99a8', 1.4],
];
function renderIndex() {
  const isWeek = state.mode === 'week';
  const key = (isWeek ? 'w' : 'm') + (state.idxType === 'sale' ? 'Sale' : 'Jeonse');
  const base = seriesInRange(rone(key, 'nowon'), isWeek);
  const labels = base.map((r) => (isWeek ? r[1].slice(2).replace(/-/g, '.') : r[0].slice(2, 4) + '.' + r[0].slice(4)));
  const ids = base.map((r) => r[0]);
  const datasets = REGION_STYLE.map(([reg, name, color, w]) => {
    const m = new Map(rone(key, reg).map((r) => [r[0], r[2]]));
    return { label: name, data: ids.map((id) => m.get(id) ?? null), borderColor: color, backgroundColor: color, borderWidth: w, pointRadius: reg === 'nowon' ? 2 : 0, tension: .25 };
  });
  const lastN = base.at(-1), firstN = base[0];
  const ch = lastN && firstN ? ((lastN[2] - firstN[2]) / firstN[2]) * 100 : null;
  $('#idxSub').innerHTML = `(${isWeek ? '주간' : '월간'} · 기간 내 노원 <b class="${cls(ch)}">${pct(ch, 2)}</b>)`;
  drawChart('cIndex', {
    type: 'line', data: { labels, datasets },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } }, y: { grid: gridOpt } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '-' : c.raw.toFixed(2)}` } } },
    },
  });
}

function renderSupply() {
  const isWeek = state.mode === 'week';
  const regs = [['dongbuk', '동북권', '#e08a1e'], ['seoul', '서울', '#12345a'], ['nation', '전국', '#8e99a8']];
  let labels, datasets;
  if (isWeek) {
    const base = seriesInRange(rone('wSupply', 'dongbuk'), true);
    labels = base.map((r) => r[1].slice(2).replace(/-/g, '.'));
    const ids = base.map((r) => r[0]);
    datasets = regs.map(([reg, name, c]) => { const m = new Map(rone('wSupply', reg).map((r) => [r[0], r[2]])); return { label: name, data: ids.map((i) => m.get(i) ?? null), borderColor: c, backgroundColor: c, tension: .25, pointRadius: 0, borderWidth: reg === 'dongbuk' ? 3 : 1.6 }; });
  } else {
    // 주간 → 월평균
    const agg = (rows) => { const m = new Map(); for (const r of rows) { const k = r[1].slice(0, 7); (m.get(k) || m.set(k, []).get(k)).push(r[2]); } return m; };
    const fM = `${String(state.from).slice(0, 4)}-${String(state.from).slice(4, 6)}`, tM = `${String(state.to).slice(0, 4)}-${String(state.to).slice(4, 6)}`;
    const all = [...agg(rone('wSupply', 'dongbuk')).keys()];
    let ks = all.filter((k) => k >= fM && k <= tM);
    if (ks.length < 6) ks = all.filter((k) => k <= tM).slice(-6);
    labels = ks.map((k) => k.slice(2).replace('-', '.'));
    datasets = regs.map(([reg, name, c]) => { const m = agg(rone('wSupply', reg)); return { label: name, data: ks.map((k) => (m.get(k) ? +avg(m.get(k)).toFixed(1) : null)), borderColor: c, backgroundColor: c, tension: .25, pointRadius: 2, borderWidth: reg === 'dongbuk' ? 3 : 1.6 }; });
  }
  drawChart('cSupply', {
    type: 'line', data: { labels, datasets },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } }, y: { grid: gridOpt } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw ?? '-'}` } } },
    },
    plugins: [{ id: 'line100', afterDraw(ch) { const y = ch.scales.y; if (100 < y.min || 100 > y.max) return; const px = y.getPixelForValue(100); const g = ch.ctx; g.save(); g.setLineDash([4, 4]); g.strokeStyle = '#999'; g.beginPath(); g.moveTo(ch.chartArea.left, px); g.lineTo(ch.chartArea.right, px); g.stroke(); g.restore(); } }],
  });
}

function renderAvg() {
  const sale = rone('mAvgPrice', 'nowon'), jeon = rone('mAvgJeonse', 'nowon'), ratio = rone('mJeonseRatio', 'nowon');
  const vol = rone('mVolume', 'nowon', '동(호)수');
  const fromM = Math.floor(state.from / 100), toM = Math.floor(state.to / 100);
  let ids = sale.map((r) => r[0]).filter((id) => +id >= fromM && +id <= toM);
  if (ids.length < 12) ids = sale.map((r) => r[0]).filter((id) => +id <= toM).slice(-12);
  const m = (rows) => { const mm = new Map(rows.map((r) => [r[0], r[2]])); return ids.map((i) => mm.get(i) ?? null); };
  drawChart('cAvg', {
    data: {
      labels: ids.map((i) => i.slice(2, 4) + '.' + i.slice(4)),
      datasets: [
        { type: 'line', label: '전세가율(%)', data: m(ratio), yAxisID: 'y2', borderColor: '#8b3a96', backgroundColor: '#8b3a96', borderDash: [5, 3], pointRadius: 2, tension: .25 },
        { type: 'line', label: '평균 매매가', data: m(sale).map((v) => (v == null ? null : Math.round(v / 10))), yAxisID: 'y', borderColor: '#12345a', backgroundColor: '#12345a', pointRadius: 2, tension: .25, borderWidth: 2.5 },
        { type: 'line', label: '평균 전세가', data: m(jeon).map((v) => (v == null ? null : Math.round(v / 10))), yAxisID: 'y', borderColor: '#22975f', backgroundColor: '#22975f', pointRadius: 2, tension: .25, borderWidth: 2.5 },
        { type: 'bar', label: '매매거래(건)', data: m(vol), yAxisID: 'y3', backgroundColor: '#c9d3e1', borderRadius: 3 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } },
        y: { position: 'left', grid: gridOpt, ticks: { callback: (v) => wonShort(v) } },
        y2: { position: 'right', grid: { display: false }, ticks: { callback: (v) => v + '%' } },
        y3: { display: false, beginAtZero: true, max: Math.max(1, ...m(vol).filter(Boolean)) * 3 },
      },
      plugins: { tooltip: { callbacks: { label: (c) => { const v = c.raw; if (v == null) return `${c.dataset.label}: -`; if (c.dataset.yAxisID === 'y') return `${c.dataset.label}: ${won(v)}`; if (c.dataset.yAxisID === 'y2') return `${c.dataset.label}: ${v.toFixed(1)}%`; return `${c.dataset.label}: ${v.toLocaleString()}건`; } } } },
    },
  });
}

/* =================== TOP10 =================== */
function topList() {
  const rows = filt(DEALS[state.deal]);
  const g = new Map();
  for (const o of rows) (g.get(o.c) || g.set(o.c, []).get(o.c)).push(o);
  const list = [...g.entries()].map(([c, a]) => {
    a.sort((x, y) => y.d - x.d);
    return {
      cx: complexes[c], cnt: a.length, last: a[0],
      ppa: avg(a.map(ppa)), max: Math.max(...a.map((o) => o.p)),
      avgRent: state.deal === 'wolse' ? avg(a.map((o) => o.m)) : null,
    };
  }).filter((x) => !/임대/.test(x.cx.name) && (state.rankBy === 'count' || x.cnt >= 2)); // 임대단지 제외
  const key = { count: (x) => x.cnt * 1e9 + x.ppa, ppa: (x) => x.ppa, max: (x) => x.max }[state.rankBy];
  list.sort((a, b) => key(b) - key(a));
  return list.slice(0, 10);
}
let top10 = [];
function renderTop10(selectFirst = true) {
  top10 = topList();
  const dLbl = state.dong === '전체' ? '노원구 전체' : state.dong;
  $('#top10Sub').textContent = `(${dLbl} · ${DEAL_NAME[state.deal]} · ${fmtD(state.from)}~${fmtD(state.to)})`;
  if (!top10.length) { $('#rankList').innerHTML = '<li class="empty">선택한 기간에 거래가 없습니다.</li>'; return; }
  $('#rankList').innerHTML = top10.map((x, i) => {
    const l = x.last;
    const price = state.deal === 'wolse' ? `${wonShort(l.p)} / ${l.m}만` : won(l.p);
    const pl = state.deal === 'wolse' ? '환산평당' : '평당';
    const sub = state.rankBy === 'count' ? `${x.cnt}건 · ${pl} ${Math.round(x.ppa).toLocaleString()}만`
      : state.rankBy === 'ppa' ? `${pl} ${Math.round(x.ppa).toLocaleString()}만 · ${x.cnt}건`
      : `최고 ${won(x.max)} · ${x.cnt}건`;
    return `<li data-c="${x.cx.id}" data-i="${i}">
      <div class="rk-no">${i + 1}</div>
      <div><div class="rk-name">${esc(x.cx.name)}</div><div class="rk-meta">${x.cx.dong} · ${x.cx.year || '-'}년 · ${sub}</div></div>
      <div class="rk-val"><b>${price}</b><span>${l.a}㎡ · ${fmtD(l.d)}</span></div></li>`;
  }).join('');
  drawTopMarkers();
  if (selectFirst) select(top10[0].cx.id, { from: 'top10' });
  else markRank();
}
function markRank() {
  $$('#rankList li').forEach((li) => li.classList.toggle('on', +li.dataset.c === state.selected));
}

/* =================== 지도 =================== */
const map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([37.645, 127.07], 14);
// 배경지도: VWorld(국토교통부, 한글) 기본 → 실패 시 Esri 자동 전환. 파일로 직접 열어도 동작.
const vworld = L.tileLayer('https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png', {
  minZoom: 6, maxZoom: 19, attribution: '&copy; VWorld(국토교통부)',
});
const esriStreet = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, attribution: 'Tiles &copy; Esri',
});
const satellite = L.layerGroup([
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri' }),
  L.tileLayer('https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; VWorld' }),
]);
vworld.addTo(map);
let tileOk = 0, tileErr = 0;
vworld.on('tileload', () => tileOk++);
vworld.on('tileerror', () => {
  if (++tileErr >= 4 && tileOk === 0 && map.hasLayer(vworld)) { map.removeLayer(vworld); esriStreet.addTo(map); }
});
L.control.layers({ '일반지도': vworld, '일반지도(Esri)': esriStreet, '위성지도': satellite }, null, { position: 'topright' }).addTo(map);
const topLayer = L.layerGroup().addTo(map), poiLayer = L.layerGroup().addTo(map), selLayer = L.layerGroup().addTo(map);
function drawTopMarkers() {
  topLayer.clearLayers();
  top10.forEach((x, i) => {
    if (x.cx.id === state.selected) return;
    L.marker([x.cx.lat, x.cx.lon], { icon: L.divIcon({ className: 'pin', html: `<div class="pin-rk">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) })
      .bindTooltip(`${i + 1}. ${x.cx.name}`).on('click', () => select(x.cx.id, { from: 'top10' })).addTo(topLayer);
  });
}
function recentTable(cx, type) {
  let rows;
  if (type === 'sale') rows = cx.sale.slice(0, 6).map((o) => `<tr><td>${fmtD(o.d)}</td><td>${o.a}㎡</td><td>${o.f}층</td><td><b>${won(o.p)}</b></td></tr>`);
  else rows = cx.rent.filter((o) => (type === 'wolse' ? o.m > 0 : o.m === 0)).slice(0, 6)
    .map((o) => `<tr><td>${fmtD(o.d)}</td><td>${o.a}㎡</td><td>${o.f}층</td><td><b>${won(o.p)}${o.m ? ' / ' + o.m + '만' : ''}</b></td></tr>`);
  return rows.length ? `<table><tr><th>계약일</th><th>전용</th><th>층</th><th>${type === 'sale' ? '거래가' : type === 'wolse' ? '보증금/월세' : '보증금'}</th></tr>${rows.join('')}</table>` : '<div class="pm">최근 거래 없음</div>';
}
function drawSelected(cx) {
  selLayer.clearLayers(); poiLayer.clearLayers();
  const ll = [cx.lat, cx.lon];
  L.circle(ll, { radius: 1000, color: '#d6334a', weight: 1.5, dashArray: '6 6', fill: true, fillOpacity: 0.04 }).addTo(selLayer);
  // 주변 시설 (1km)
  const near = (cat, r) => POIS.filter((p) => p[0] === cat && dist(cx.lat, cx.lon, p[2], p[3]) <= r);
  const dot = (p, color, label) => L.circleMarker([p[2], p[3]], { radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 }).bindTooltip(label || p[1]).addTo(poiLayer);
  S.stations.filter((s) => dist(cx.lat, cx.lon, s.lat, s.lon) <= 1600).forEach((s) => L.circleMarker([s.lat, s.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#00A5DE', fillOpacity: 1 }).bindTooltip(`${s.n}역 (${s.l.join('·')})`, { permanent: true, direction: 'top', offset: [0, -6], className: 'stn-tip' }).addTo(poiLayer));
  ['elem', 'middle', 'high'].forEach((c) => near(c, 1000).forEach((p) => dot(p, '#22975f')));
  ['mart', 'dept'].forEach((c) => near(c, 1000).forEach((p) => dot(p, '#e08a1e')));
  const type = state.deal;
  const recent = cx.sale[0];
  const popup = `<div class="pop"><h4>${esc(cx.name)}</h4>
    <div class="pm">노원구 ${cx.dong} ${esc(cx.jibun)}${cx.road ? ' · ' + esc(cx.road) : ''} · ${cx.year || '-'}년${cx.g ? '' : ' · <b>위치 근사</b>'}</div>
    ${recent ? `<div>최근 매매 <span class="pbig">${won(recent.p)}</span> <span class="pm">(${recent.a}㎡ · ${fmtD(recent.d)})</span></div>` : ''}
    <div class="pm" style="margin-top:6px">최근 ${DEAL_NAME[type]} 실거래</div>${recentTable(cx, type)}</div>`;
  const icon = L.divIcon({ className: 'pin', html: `<div class="pin-sel"><div class="bub">${esc(cx.name)}</div><div class="tip"></div></div>`, iconSize: [0, 0] });
  const mk = L.marker(ll, { icon, zIndexOffset: 1000 }).addTo(selLayer);
  const pop = L.popup({ maxWidth: 340, offset: [0, -34], autoPanPaddingTopLeft: [20, 40] }).setLatLng(ll).setContent(popup);
  mk.on('click', () => pop.openOn(map));
  map.setView(ll, 15, { animate: true });
  setTimeout(() => pop.openOn(map), 250);
}

/* =================== 선택 & 입지분석 =================== */
function select(cxId, opt = {}) {
  state.selected = cxId;
  if (opt.from !== 'listing') state.listing = null;
  const cx = complexes[cxId];
  markRank();
  $$('#aptTable tbody tr').forEach((tr) => tr.classList.toggle('on', +tr.dataset.c === cxId));
  $$('.lst').forEach((el) => el.classList.toggle('on', el.dataset.id === state.listing));
  drawTopMarkers();
  drawSelected(cx);
  renderAnalysis(cx);
  if (opt.scroll) document.getElementById(opt.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function nearest(cat, cx, n, maxM = 5000) {
  return POIS.filter((p) => p[0] === cat)
    .map((p) => ({ n: p[1], d: dist(cx.lat, cx.lon, p[2], p[3]), extra: p[4] }))
    .filter((p) => p.d <= maxM)
    .sort((a, b) => a.d - b.d)
    .filter((p, i, arr) => arr.findIndex((q) => q.n === p.n || (Math.abs(q.d - p.d) < 60 && (q.n.includes(p.n) || p.n.includes(q.n)))) === i)
    .slice(0, n);
}
const li = (name, d, extra = '') => `<li><span class="nm">${name}${extra}</span><span class="ds">${d}</span></li>`;
const lineBadges = (ls) => ls.map((l) => `<span class="line-badge" style="background:${S.lineColors[l] || '#888'}">${l.replace('호선', '')}</span>`).join('');

function renderAnalysis(cx) {
  const el = $('#analysis');
  const lst = state.listing ? getListings().find((l) => l.id === state.listing) : null;
  // --- 가격 요약
  const y1 = toInt(new Date(fromInt(maxDate).setFullYear(fromInt(maxDate).getFullYear() - 1)));
  const s1 = cx.sale.filter((o) => o.d >= y1), j1 = cx.rent.filter((o) => o.d >= y1 && o.m === 0);
  const cxPPA = avg(s1.map(ppa));
  const guPPA = avg(SALES.filter((o) => o.d >= y1).map(ppa));
  const jr = cxPPA && j1.length ? (avg(j1.map(ppa)) / cxPPA) * 100 : null;
  const age = cx.year ? new Date().getFullYear() - cx.year : null;

  // --- 교통
  const stns = S.stations.map((s) => ({ ...s, d: dist(cx.lat, cx.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const rail = S.rail.map((r) => ({ n: r.n, desc: r.d, m: dist(cx.lat, cx.lon, r.lat, r.lon) })).sort((a, b) => a.m - b.m);
  const buses = POIS.filter((p) => p[0] === 'bus').map((p) => ({ n: p[1], d: dist(cx.lat, cx.lon, p[2], p[3]) })).sort((a, b) => a.d - b.d);
  const bus300 = buses.filter((b) => b.d <= 300);
  const busNames = buses.filter((b, i, a) => a.findIndex((q) => q.n === b.n) === i).slice(0, 4);
  const dongbuk = S.dev[0].pts.map((p) => dist(cx.lat, cx.lon, p[0], p[1])).sort((a, b) => a - b)[0];

  // --- 학군
  const elem = nearest('elem', cx, 3), mid = nearest('middle', cx, 3), high = nearest('high', cx, 3);
  const acad = S.academy.map((a) => ({ ...a, d: dist(cx.lat, cx.lon, a.lat, a.lon) }));

  // --- 상권
  const dept = nearest('dept', cx, 3, 6000);
  const marts = nearest('mart', cx, 4, 3000);
  const bigMart = nearest('mart', cx, 50, 6000).filter((m) => /이마트|홈플러스|롯데마트|코스트코|하나로/.test(m.n)).slice(0, 2);
  const cafes = POIS.filter((p) => p[0] === 'cafe').map((p) => ({ n: p[1], d: dist(cx.lat, cx.lon, p[2], p[3]) }));
  const cafe500 = cafes.filter((c) => c.d <= 1000);
  const cafeNear = cafes.sort((a, b) => a.d - b.d).filter((c, i, a) => a.findIndex((q) => q.n === c.n) === i).slice(0, 3);
  const gov = nearest('gov', cx, 3, 3000);
  const hosp = nearest('hospital', cx, 2, 5000);
  const park = nearest('park', cx, 2, 2000);
  const lib = nearest('library', cx, 1, 2000);

  // --- 개발계획
  const devs = S.dev.map((d) => ({ n: d.n, s: d.s, desc: d.d, m: Math.min(...d.pts.map((p) => dist(cx.lat, cx.lon, p[0], p[1]))) })).sort((a, b) => a.m - b.m);

  const walkOrKm = (m) => (m <= 1500 ? `${fmtDist(m)} · ${walk(m)}` : fmtDist(m));
  const listingHTML = lst ? `<div class="an-listing">📌 <b>추천매물</b> · ${esc(lst.title)} — <b>${listingPrice(lst)}</b> · 전용 ${lst.area}㎡(약 ${pyeong(lst.area)}평형) · ${esc(lst.floor || '')} ${lst.memo ? '· ' + esc(lst.memo) : ''}</div>` : '';
  const stationTag = stns[0] && stns[0].d <= 700 ? `<span class="tagline">${stns[0].n}역 역세권</span>` : '';

  el.innerHTML = `
  <div class="an-head">
    <div>
      <div class="an-title">${esc(cx.name)} 입지분석 ${stationTag}</div>
      <div class="an-addr">서울특별시 노원구 ${cx.dong} ${esc(cx.jibun)}${cx.road ? ' (' + esc(cx.road) + ')' : ''} · ${cx.year || '-'}년 준공${age != null ? ` (${age}년차)` : ''}${cx.g ? '' : ' · 좌표는 동 중심 근사값'}</div>
    </div>
    <div class="an-stats">
      <div class="an-stat"><div class="l">최근 매매</div><div class="v">${cx.sale[0] ? won(cx.sale[0].p) : '-'}</div><div class="l">${cx.sale[0] ? cx.sale[0].a + '㎡ · ' + fmtD(cx.sale[0].d) : ''}</div></div>
      <div class="an-stat"><div class="l">최근 전세</div><div class="v">${(() => { const r = cx.rent.find((o) => o.m === 0); return r ? won(r.p) : '-'; })()}</div><div class="l">${(() => { const r = cx.rent.find((o) => o.m === 0); return r ? r.a + '㎡ · ' + fmtD(r.d) : ''; })()}</div></div>
      <div class="an-stat"><div class="l">1년 평균 평당가</div><div class="v">${cxPPA ? Math.round(cxPPA).toLocaleString() + '만' : '-'}</div><div class="l">노원구 평균 대비 <b class="${cls(cxPPA - guPPA)}">${cxPPA ? pct(((cxPPA - guPPA) / guPPA) * 100) : '-'}</b></div></div>
      <div class="an-stat"><div class="l">전세가율(1년)</div><div class="v">${jr ? jr.toFixed(1) + '%' : '-'}</div><div class="l">매매 ${s1.length}건 · 전세 ${j1.length}건</div></div>
    </div>
  </div>
  ${listingHTML}
  <div class="an-grid">
    <div class="an-col" style="--c:#2563c9">
      <h3><span class="ic">🚇</span>교통</h3>
      <h4>지하철</h4>
      <ul>${stns.map((s) => li(`${s.n}역`, walkOrKm(s.d), lineBadges(s.l))).join('')}</ul>
      <h4>KTX · SRT · GTX</h4>
      <ul>${rail.map((r) => li(`${esc(r.n)}`, fmtDist(r.m), `<br><small>${esc(r.desc)}</small>`)).join('')}</ul>
      <h4>버스</h4>
      <ul>${li('반경 300m 정류장', `${new Set(bus300.map((b) => b.n)).size}곳`)}${busNames.map((b) => li(esc(b.n), fmtDist(b.d))).join('')}</ul>
      <div class="score"><span>동북선 예정역 ${fmtDist(dongbuk)}</span></div>
    </div>
    <div class="an-col" style="--c:#22975f">
      <h3><span class="ic">🎓</span>학군</h3>
      <h4>초등학교</h4><ul>${elem.map((s) => li(esc(s.n), walkOrKm(s.d))).join('') || '<li>정보 없음</li>'}</ul>
      <h4>중학교</h4><ul>${mid.map((s) => li(esc(s.n), walkOrKm(s.d))).join('') || '<li>정보 없음</li>'}</ul>
      <h4>고등학교</h4><ul>${high.map((s) => li(esc(s.n), walkOrKm(s.d))).join('') || '<li>정보 없음</li>'}</ul>
      <h4>학원가</h4><ul>${acad.map((a) => li(esc(a.n), walkOrKm(a.d))).join('')}</ul>
      <p class="note">실제 배정 학교는 교육청 학구도 안내서비스로 확인 필요</p>
    </div>
    <div class="an-col" style="--c:#e08a1e">
      <h3><span class="ic">🛍️</span>상권 · 생활</h3>
      <h4>백화점 · 쇼핑몰</h4><ul>${dept.map((s) => li(esc(s.n), fmtDist(s.d))).join('') || '<li>정보 없음</li>'}</ul>
      <h4>대형마트 · 마트</h4><ul>${[...bigMart, ...marts.filter((m) => !bigMart.some((b) => b.n === m.n))].slice(0, 4).map((s) => li(esc(s.n), fmtDist(s.d))).join('') || '<li>정보 없음</li>'}</ul>
      <h4>카페 <small>(반경 1km ${cafe500.length}곳)</small></h4><ul>${cafeNear.map((s) => li(esc(s.n), fmtDist(s.d))).join('')}</ul>
      <h4>관공서 · 의료 · 공원</h4><ul>${gov.map((s) => li('🏛 ' + esc(s.n), fmtDist(s.d))).join('')}${hosp.map((s) => li('🏥 ' + esc(s.n), fmtDist(s.d))).join('')}${park.map((s) => li('🌳 ' + esc(s.n), fmtDist(s.d))).join('')}${lib.map((s) => li('📚 ' + esc(s.n), fmtDist(s.d))).join('')}</ul>
    </div>
    <div class="an-col" style="--c:#c0392b">
      <h3><span class="ic">🏗️</span>주변 개발계획</h3>
      ${devs.slice(0, 6).map((d) => `<div class="dev ${d.m <= 1500 ? 'near' : ''}" style="--c:${d.m <= 1500 ? '#d6334a' : '#c9d3e1'}">
        <div class="dn">${esc(d.n)}</div>
        <div class="ds2">${fmtDist(d.m)} · ${esc(d.s)}</div>
        <div class="dd">${esc(d.desc)}</div></div>`).join('')}
      <p class="note">2026년 공개자료 요약 · 일정/규모는 변동 가능</p>
    </div>
  </div>`;
}

/* =================== 추천매물 =================== */
const LS_KEY = 'pss_listings_v1';
function getListings() {
  try { const s = localStorage.getItem(LS_KEY); if (s) return JSON.parse(s); } catch {}
  return S.sampleListings.slice();
}
function saveListings(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {} }
function listingPrice(l) { return l.type === '월세' ? `${won(+l.price)} / 월 ${(+l.rent || 0).toLocaleString()}만` : won(+l.price); }
function findCx(name, dong) {
  const n = normName(name);
  return complexes.find((c) => normName(c.name) === n && (!dong || c.dong === dong)) || complexes.find((c) => normName(c.name) === n)
    || complexes.find((c) => normName(c.name).includes(n) || n.includes(normName(c.name)));
}
const TYPE_BG = { 매매: 'linear-gradient(135deg,#12345a,#2b6aa3)', 전세: 'linear-gradient(135deg,#167a4b,#3cc07f)', 월세: 'linear-gradient(135deg,#b4640c,#f0a845)' };
const BLD_SVG = '<svg viewBox="0 0 120 92"><g fill="rgba(255,255,255,.28)"><rect x="4" y="30" width="26" height="62"/><rect x="34" y="8" width="30" height="84"/><rect x="68" y="22" width="24" height="70"/><rect x="96" y="44" width="20" height="48"/></g><g fill="rgba(255,255,255,.5)"><rect x="40" y="16" width="5" height="5"/><rect x="52" y="16" width="5" height="5"/><rect x="40" y="28" width="5" height="5"/><rect x="52" y="28" width="5" height="5"/><rect x="40" y="40" width="5" height="5"/><rect x="52" y="40" width="5" height="5"/><rect x="40" y="52" width="5" height="5"/><rect x="52" y="52" width="5" height="5"/></g></svg>';
function renderListings() {
  const arr = getListings();
  $('#listings').innerHTML = arr.map((l) => {
    const cx = findCx(l.apt, l.dong);
    let cmp = '실거래 비교 데이터 없음';
    if (cx) {
      const same = (o) => Math.abs(o.a - l.area) <= 3;
      if (l.type === '매매') { const r = cx.sale.find(same); if (r) cmp = `동일평형 최근 실거래 ${won(r.p)} (${fmtD(r.d)})`; }
      else { const r = cx.rent.find((o) => same(o) && (l.type === '월세' ? o.m > 0 : o.m === 0)); if (r) cmp = `동일평형 최근 ${l.type} ${won(r.p)}${r.m ? '/' + r.m + '만' : ''} (${fmtD(r.d)})`; }
    }
    return `<div class="lst" data-id="${esc(l.id)}" data-c="${cx ? cx.id : ''}">
      <button class="lst-del" data-del="${esc(l.id)}" title="삭제">×</button>
      <div class="lst-img" style="background:${TYPE_BG[l.type] || TYPE_BG['매매']}">${BLD_SVG}<span class="lst-type" style="color:${l.type === '매매' ? '#12345a' : l.type === '전세' ? '#167a4b' : '#b4640c'}">${esc(l.type)}</span><div class="lst-apt">${esc(l.apt)}</div></div>
      <div class="lst-body">
        <div class="lst-price">${listingPrice(l)}</div>
        <div class="lst-title">${esc(l.title)}</div>
        <div class="lst-meta">${esc(cx ? cx.dong : l.dong || '')} · 전용 ${l.area}㎡ (약 ${pyeong(l.area)}평형) · ${esc(l.floor || '')}${cx && cx.year ? ' · ' + cx.year + '년' : ''}</div>
        <div class="tags">${(l.tags || []).map((t) => `<span>#${esc(t)}</span>`).join('')}</div>
        <div class="lst-cmp">${cmp}</div>
      </div></div>`;
  }).join('');
}

/* =================== 아파트 리스트 =================== */
function renderAptTable() {
  const s = filt(SALES), j = filt(JEONSE), w = filt(WOLSE);
  const agg = new Map();
  const get = (c) => agg.get(c) || agg.set(c, { s: [], j: [], w: 0 }).get(c);
  s.forEach((o) => get(o.c).s.push(o)); j.forEach((o) => get(o.c).j.push(o)); w.forEach((o) => get(o.c).w++);
  const q = normName(state.search || '');
  let rows = complexes.filter((c) => (state.dong === '전체' || c.dong === state.dong) && (!q || normName(c.name).includes(q))).map((c) => {
    const a = agg.get(c.id) || { s: [], j: [], w: 0 };
    a.s.sort((x, y) => y.d - x.d); a.j.sort((x, y) => y.d - x.d);
    return { c, name: c.name, dong: c.dong, year: c.year || 0, saleCnt: a.s.length, lastSale: a.s[0]?.p || 0, lastSaleO: a.s[0], ppa: a.s.length ? avg(a.s.map(ppa)) : 0, jeonseCnt: a.j.length, lastJeonse: a.j[0]?.p || 0, lastJO: a.j[0], wolseCnt: a.w };
  });
  const k = state.sortKey, dir = state.sortAsc ? 1 : -1;
  rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k], 'ko') : a[k] - b[k]) * dir || b.saleCnt - a.saleCnt);
  $('#aptListTitle').innerHTML = `${state.dong === '전체' ? '노원구' : state.dong} 아파트 리스트 <small>${rows.length}개 단지</small>`;
  $$('#aptTable th').forEach((th) => { th.classList.toggle('sorted', th.dataset.k === k); th.classList.toggle('asc', th.dataset.k === k && state.sortAsc); });
  $('#aptTable tbody').innerHTML = rows.map((r) => `<tr data-c="${r.c.id}" class="${r.c.id === state.selected ? 'on' : ''}">
    <td><b>${esc(r.name)}</b></td><td>${r.dong}</td><td class="r">${r.year || '-'}</td>
    <td class="r">${r.saleCnt || '-'}</td><td class="r">${r.lastSaleO ? `${won(r.lastSale)} <small>${r.lastSaleO.a}㎡</small>` : '-'}</td>
    <td class="r">${r.ppa ? Math.round(r.ppa).toLocaleString() + '만' : '-'}</td>
    <td class="r">${r.jeonseCnt || '-'}</td><td class="r">${r.lastJO ? `${won(r.lastJeonse)} <small>${r.lastJO.a}㎡</small>` : '-'}</td>
    <td class="r">${r.wolseCnt || '-'}</td></tr>`).join('');
}

/* =================== 렌더 & 이벤트 =================== */
function renderAll(selectFirst = true) {
  renderKPIs(); renderTrend(); renderIndex(); renderSupply(); renderAvg();
  renderAptTable(); renderTop10(selectFirst);
}

// 동 칩
$('#dongChips').innerHTML = DONGS.map((d) => `<button data-d="${d}" class="${d === '전체' ? 'on' : ''}">${d === '전체' ? '노원구 전체' : d}</button>`).join('');
$('#dongChips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.dong = b.dataset.d;
  $$('#dongChips button').forEach((x) => x.classList.toggle('on', x === b));
  renderAll();
});
$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.mode = b.dataset.mode;
  $$('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderTrend(); renderIndex(); renderSupply(); renderAvg();
});
$('#presets').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  setPreset(b.dataset.p); renderAll();
});
const onDate = () => {
  const f = $('#dFrom').value, t = $('#dTo').value;
  if (!f || !t) return;
  let a = toInt(fromISO(f)), z = toInt(fromISO(t));
  if (a > z) [a, z] = [z, a];
  state.from = a; state.to = z;
  $$('#presets button').forEach((x) => x.classList.remove('on'));
  renderAll();
};
$('#dFrom').addEventListener('change', onDate);
$('#dTo').addEventListener('change', onDate);
const segHandler = (id, key, after) => $(id).addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state[key] = Object.values(b.dataset)[0];
  $$(id + ' button').forEach((x) => x.classList.toggle('on', x === b));
  after();
});
segHandler('#trendSeg', 'trendType', renderTrend);
segHandler('#idxSeg', 'idxType', renderIndex);
segHandler('#dealSeg', 'deal', () => renderTop10(true));
$('#rankBy').addEventListener('change', (e) => { state.rankBy = e.target.value; renderTop10(true); });
$('#rankList').addEventListener('click', (e) => { const li = e.target.closest('li[data-c]'); if (li) select(+li.dataset.c, { from: 'top10' }); });
$('#aptTable thead').addEventListener('click', (e) => {
  const th = e.target.closest('th'); if (!th) return;
  if (state.sortKey === th.dataset.k) state.sortAsc = !state.sortAsc; else { state.sortKey = th.dataset.k; state.sortAsc = th.dataset.k === 'name' || th.dataset.k === 'dong'; }
  renderAptTable();
});
$('#aptTable tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-c]'); if (tr) select(+tr.dataset.c, { scroll: 'top10Section' }); });
$('#aptSearch').addEventListener('input', (e) => { state.search = e.target.value; renderAptTable(); });

// 추천매물 이벤트
$('#listings').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    if (!confirm('이 매물을 삭제할까요?')) return;
    saveListings(getListings().filter((l) => l.id !== del.dataset.del)); renderListings(); return;
  }
  const card = e.target.closest('.lst'); if (!card) return;
  if (card.dataset.c === '') { alert('해당 단지의 실거래 데이터를 찾지 못했습니다. 단지명을 확인해주세요.'); return; }
  state.listing = card.dataset.id;
  select(+card.dataset.c, { from: 'listing', scroll: 'top10Section' });
});
$('#resetListings').addEventListener('click', () => { if (confirm('추천매물을 샘플 4건으로 되돌릴까요? (등록한 매물은 삭제됩니다)')) { try { localStorage.removeItem(LS_KEY); } catch {} renderListings(); } });
$('#aptNames').innerHTML = complexes.map((c) => `<option value="${esc(c.name)}">${c.dong}</option>`).join('');
$('#addListing').addEventListener('click', () => { $('#listingForm').reset(); $('#listingDlg').showModal(); });
$('#listingDlg').addEventListener('close', () => {
  if ($('#listingDlg').returnValue !== 'ok') return;
  const f = new FormData($('#listingForm'));
  const o = Object.fromEntries(f.entries());
  const cx = findCx(o.apt);
  const l = { id: 'u' + Date.now(), apt: o.apt, dong: cx ? cx.dong : '', type: o.type, price: +o.price, rent: +o.rent || 0, area: +o.area, floor: o.floor, title: o.title, tags: o.tags.split(',').map((t) => t.trim()).filter(Boolean), memo: o.memo };
  const arr = getListings(); arr.push(l); saveListings(arr); renderListings();
});

// 초기화
$('#updated').textContent = `데이터 기준: ${new Date(D.updated).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })} · 실거래 최신 계약일 ${fmtD(maxDate)}`;
setPreset('3m');
renderListings();
renderAll(true);
})();
