// 노원구 부동산 대시보드 데이터 수집 스크립트
// 실행: node scripts/fetch_data.mjs   (옵션: --skip-geo, --skip-poi)
// 출력: data/data.js (실거래·지수), data/pois.js (주변시설), data/geocache.json (단지 좌표 캐시)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
// API 키: scripts/config.json (git 제외) 또는 환경변수 DATA_GO_KR_KEY / REB_KEY
const cfgFile = path.join(__dirname, 'config.json');
const cfg = { LAWD_CD: '11350', START_YM: '202401', ...(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}) };
if (process.env.DATA_GO_KR_KEY) cfg.DATA_GO_KR_KEY = process.env.DATA_GO_KR_KEY;
if (process.env.REB_KEY) cfg.REB_KEY = process.env.REB_KEY;
if (!cfg.DATA_GO_KR_KEY || !cfg.REB_KEY) { console.error('API 키가 없습니다. scripts/config.example.json 을 config.json 으로 복사해 키를 입력하세요.'); process.exit(1); }
const args = new Set(process.argv.slice(2));
const UA = 'NowonRealEstateDashboard/1.0 (local broker dashboard)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(opts.method === 'POST' ? 180000 : 20000), ...opts });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// ---------------- 1. 국토부 실거래가 (매매 / 전월세) ----------------
function parseItems(xml) {
  const items = [];
  const code = (xml.match(/<resultCode>(.*?)<\/resultCode>/) || [])[1];
  if (code && code !== '000' && code !== '00') throw new Error('API error: ' + xml.slice(0, 300));
  if (/SERVICE_KEY|errMsg/.test(xml) && !code) throw new Error('API error: ' + xml.slice(0, 300));
  const total = +((xml.match(/<totalCount>(\d+)<\/totalCount>/) || [])[1] || 0);
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const o = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = f[2].trim();
    items.push(o);
  }
  return { items, total };
}

function monthsFrom(startYM) {
  const out = [];
  const now = new Date();
  let y = +startYM.slice(0, 4), m = +startYM.slice(4, 6);
  const ey = now.getFullYear(), em = now.getMonth() + 1;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

async function fetchRTMS(endpoint, ym) {
  const all = [];
  for (let page = 1; page < 50; page++) {
    const url = `${endpoint}?serviceKey=${cfg.DATA_GO_KR_KEY}&LAWD_CD=${cfg.LAWD_CD}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
    const { items, total } = parseItems(await get(url));
    all.push(...items);
    if (all.length >= total || items.length === 0) break;
  }
  return all;
}

const num = (s) => +String(s || '0').replace(/,/g, '') || 0;

// 단지 마스터: key = 동|지번|단지명
const aptIndex = new Map();
const apts = [];
function aptId(o) {
  const key = `${o.umdNm}|${o.jibun}|${o.aptNm}`;
  let id = aptIndex.get(key);
  if (id === undefined) {
    id = apts.length;
    aptIndex.set(key, id);
    apts.push({ n: o.aptNm, d: o.umdNm, j: o.jibun, y: +o.buildYear || null, r: '' });
  }
  const a = apts[id];
  if (!a.r && o.roadnm) a.r = o.roadnm;
  if (!a.y && o.buildYear) a.y = +o.buildYear;
  return id;
}

async function fetchDeals() {
  const months = monthsFrom(cfg.START_YM);
  const trades = [], rents = [];
  const base = 'https://apis.data.go.kr/1613000';
  for (const ym of months) {
    const t = await fetchRTMS(`${base}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`, ym);
    for (const o of t) {
      const date = +`${o.dealYear}${String(o.dealMonth).padStart(2, '0')}${String(o.dealDay).padStart(2, '0')}`;
      const cancel = o.cdealType && o.cdealType.trim() ? 1 : 0;
      trades.push([aptId(o), date, num(o.dealAmount), +(+o.excluUseAr).toFixed(2), +o.floor || 0, cancel]);
    }
    const r = await fetchRTMS(`${base}/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`, ym);
    for (const o of r) {
      const date = +`${o.dealYear}${String(o.dealMonth).padStart(2, '0')}${String(o.dealDay).padStart(2, '0')}`;
      rents.push([aptId(o), date, num(o.deposit), num(o.monthlyRent), +(+o.excluUseAr).toFixed(2), +o.floor || 0]);
    }
    console.log(`  ${ym}: 매매 ${t.length}건, 전월세 ${r.length}건`);
  }
  return { trades, rents };
}

// ---------------- 2. 한국부동산원 R-ONE 통계 ----------------
const RONE = 'https://www.reb.or.kr/r-one/openapi';
async function roneJSON(api, params) {
  const qs = new URLSearchParams({ KEY: cfg.REB_KEY, Type: 'json', ...params });
  const j = JSON.parse(await get(`${RONE}/${api}.do?${qs}`));
  const body = j[api];
  if (!body) return { rows: [], total: 0 };
  const head = body[0].head;
  return { rows: body[1]?.row || [], total: head?.[0]?.list_total_count || 0 };
}
async function roneItems(tbl) {
  const { rows } = await roneJSON('SttsApiTblItm', { STATBL_ID: tbl, pIndex: 1, pSize: 1000 });
  return rows;
}
async function roneData(tbl, cycle, clsId, start) {
  const out = [];
  for (let p = 1; p < 30; p++) {
    const { rows, total } = await roneJSON('SttsApiTblData', {
      STATBL_ID: tbl, DTACYCLE_CD: cycle, CLS_ID: clsId, START_WRTTIME: start, pIndex: p, pSize: 1000,
    });
    out.push(...rows);
    if (out.length >= total || rows.length === 0) break;
  }
  return out;
}

const RONE_TABLES = [
  { key: 'wSale', id: 'T244183132827305', cycle: 'WK', start: '202401', name: '주간 아파트 매매가격지수' },
  { key: 'wJeonse', id: 'T247713133046872', cycle: 'WK', start: '202401', name: '주간 아파트 전세가격지수' },
  { key: 'wSupply', id: 'T248163133074619', cycle: 'WK', start: '202401', name: '주간 아파트 매매수급동향' },
  { key: 'mSale', id: 'A_2024_00045', cycle: 'MM', start: '202001', name: '월간 아파트 매매가격지수' },
  { key: 'mJeonse', id: 'A_2024_00050', cycle: 'MM', start: '202001', name: '월간 아파트 전세가격지수' },
  { key: 'mAvgPrice', id: 'A_2024_00060', cycle: 'MM', start: '202001', name: '월간 아파트 평균매매가격' },
  { key: 'mAvgJeonse', id: 'A_2024_00064', cycle: 'MM', start: '202001', name: '월간 아파트 평균전세가격' },
  { key: 'mJeonseRatio', id: 'A_2024_00072', cycle: 'MM', start: '202001', name: '매매가격 대비 전세가격 비율' },
  { key: 'mVolume', id: 'A_2024_00554', cycle: 'MM', start: '202001', name: '아파트 매매거래현황' },
  { key: 'mUnsold', id: 'T237973129847263', cycle: 'MM', start: '202001', name: '미분양주택현황' },
];
// 지역 이름 매칭 (노원구 / 서울 / 동북권 / 전국)
const REGIONS = [
  { key: 'nowon', test: (f) => /노원구$/.test(f) },
  { key: 'seoul', test: (f) => f === '서울' || f === '서울>계' },
  { key: 'dongbuk', test: (f) => /동북권$/.test(f) },
  { key: 'nation', test: (f) => f === '전국' || f === '전국>계' },
];

async function fetchRone() {
  const out = {};
  for (const t of RONE_TABLES) {
    try {
      const items = await roneItems(t.id);
      const cls = items.filter((x) => x.ITM_TAG === '분류' || x.ITM_TAG === 'CLS' || true);
      const series = {};
      for (const reg of REGIONS) {
        const hit = cls.find((x) => reg.test(x.ITM_FULLNM));
        if (!hit) continue;
        const rows = await roneData(t.id, t.cycle, hit.ITM_ID, t.start);
        if (!rows.length) continue;
        // group by item name (ex: 지수, 거래량 등)
        const byItem = {};
        for (const r of rows) {
          const k = [r.GRP_NM, r.ITM_NM].filter(Boolean).join(' / ');
          (byItem[k] ||= []).push([r.WRTTIME_IDTFR_ID, r.WRTTIME_DESC, r.DTA_VAL == null ? null : +(+r.DTA_VAL).toFixed(3)]);
        }
        for (const k in byItem) byItem[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        series[reg.key] = byItem;
      }
      out[t.key] = { name: t.name, cycle: t.cycle, series };
      console.log(`  R-ONE ${t.name}: ${Object.keys(series).join(', ') || '(지역 없음)'}`);
    } catch (e) {
      console.warn(`  R-ONE ${t.name} 실패: ${e.message}`);
    }
  }
  return out;
}

// ---------------- 3. 단지 좌표 (Nominatim, 캐시) ----------------
const DONG_CENTER = {
  상계동: [37.6600, 127.0680], 중계동: [37.6470, 127.0750], 하계동: [37.6370, 127.0680],
  공릉동: [37.6250, 127.0800], 월계동: [37.6250, 127.0580],
};
async function geocode(list) {
  const cacheFile = path.join(DATA_DIR, 'geocache.json');
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const inNowon = (lat, lon) => lat > 37.59 && lat < 37.70 && lon > 127.03 && lon < 127.12;
  let n = 0;
  for (const a of list) {
    const key = `${a.d}|${a.j}|${a.n}`;
    if (cache[key]) continue;
    const queries = [];
    if (a.r) queries.push(`서울특별시 노원구 ${a.r}`);
    queries.push(`서울특별시 노원구 ${a.d} ${a.j}`);
    queries.push(`노원구 ${a.n.replace(/아파트$/, '')}`);
    let hit = null;
    for (const q of queries) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=${encodeURIComponent(q)}`;
        const j = JSON.parse(await get(url));
        await sleep(1100);
        if (j[0] && inNowon(+j[0].lat, +j[0].lon)) { hit = [+(+j[0].lat).toFixed(6), +(+j[0].lon).toFixed(6), q]; break; }
      } catch { await sleep(2000); }
    }
    cache[key] = hit || null;
    if (++n % 20 === 0) { fs.writeFileSync(cacheFile, JSON.stringify(cache)); console.log(`  지오코딩 ${n}건...`); }
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  let ok = 0;
  for (const a of list) {
    const c = cache[`${a.d}|${a.j}|${a.n}`];
    if (c) { a.lat = c[0]; a.lon = c[1]; a.g = 1; ok++; }
    else {
      const ctr = DONG_CENTER[a.d] || [37.654, 127.056];
      a.lat = ctr[0]; a.lon = ctr[1]; a.g = 0; // 근사 위치
    }
  }
  console.log(`  좌표 확보 ${ok}/${list.length} 단지`);
}

// ---------------- 4. 주변시설 (OpenStreetMap Overpass) ----------------
async function fetchPOIs() {
  const bbox = '37.585,127.020,37.715,127.135';
  const q = `[out:json][timeout:120];
(
  node["railway"="station"](${bbox});
  node["public_transport"="station"]["railway"](${bbox});
  node["highway"="bus_stop"](${bbox});
  nwr["amenity"="school"](${bbox});
  nwr["shop"="department_store"](${bbox});
  nwr["shop"="supermarket"](${bbox});
  nwr["shop"="mall"](${bbox});
  nwr["amenity"="cafe"](${bbox});
  nwr["amenity"="townhall"](${bbox});
  nwr["office"="government"](${bbox});
  nwr["amenity"="hospital"](${bbox});
  nwr["amenity"="library"](${bbox});
  nwr["leisure"="park"]["name"](${bbox});
);
out tags center;`;
  const body = new URLSearchParams({ data: q });
  const txt = await get('https://overpass-api.de/api/interpreter', { method: 'POST', body });
  const els = JSON.parse(txt).elements;
  const out = [];
  const seen = new Set();
  for (const e of els) {
    const t = e.tags || {};
    const name = t['name:ko'] || t.name;
    if (!name) continue;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    let c = null, sub = '';
    if (t.railway === 'station' || (t.public_transport === 'station' && t.railway)) { c = 'subway'; sub = t.line || t['railway:ref'] || t.operator || ''; }
    else if (t.highway === 'bus_stop') c = 'bus';
    else if (t.amenity === 'school') {
      if (/초등학교/.test(name)) c = 'elem'; else if (/중학교/.test(name)) c = 'middle'; else if (/고등학교|고교|과학고|외고/.test(name)) c = 'high'; else continue;
    }
    else if (t.shop === 'department_store' || t.shop === 'mall') c = 'dept';
    else if (t.shop === 'supermarket') c = 'mart';
    else if (t.amenity === 'cafe') c = 'cafe';
    else if (t.amenity === 'townhall' || t.office === 'government') c = 'gov';
    else if (t.amenity === 'hospital') c = 'hospital';
    else if (t.amenity === 'library') c = 'library';
    else if (t.leisure === 'park') c = 'park';
    if (!c) continue;
    const key = `${c}|${name}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = [c, name, +lat.toFixed(6), +lon.toFixed(6)];
    if (c === 'cafe' && t.brand) row.push(t.brand);
    if (c === 'subway') row.push(sub);
    out.push(row);
  }
  const counts = out.reduce((m, r) => ((m[r[0]] = (m[r[0]] || 0) + 1), m), {});
  console.log('  주변시설:', JSON.stringify(counts));
  return out;
}

// ---------------- main ----------------
(async () => {
  const t0 = Date.now();
  console.log('[1/4] 국토부 실거래가 수집');
  const { trades, rents } = await fetchDeals();
  console.log('[2/4] 한국부동산원 R-ONE 통계 수집');
  const rone = await fetchRone();
  console.log('[3/4] 단지 좌표');
  if (args.has('--skip-geo')) {
    const cacheFile = path.join(DATA_DIR, 'geocache.json');
    if (!fs.existsSync(cacheFile)) fs.writeFileSync(cacheFile, '{}');
    // 캐시만 적용
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    for (const a of apts) {
      const c = cache[`${a.d}|${a.j}|${a.n}`];
      const ctr = DONG_CENTER[a.d] || [37.654, 127.056];
      Object.assign(a, c ? { lat: c[0], lon: c[1], g: 1 } : { lat: ctr[0], lon: ctr[1], g: 0 });
    }
  } else {
    await geocode(apts);
  }
  const updated = new Date().toISOString();
  fs.writeFileSync(path.join(DATA_DIR, 'data.js'),
    `// 자동 생성 파일 (scripts/fetch_data.mjs) - ${updated}\nwindow.DATA=${JSON.stringify({ updated, apts, trades, rents, rone })};\n`);
  console.log(`  data.js 저장 (단지 ${apts.length}, 매매 ${trades.length}, 전월세 ${rents.length})`);
  console.log('[4/4] 주변시설(POI)');
  if (!args.has('--skip-poi')) {
    try {
      const pois = await fetchPOIs();
      fs.writeFileSync(path.join(DATA_DIR, 'pois.js'), `window.POIS=${JSON.stringify(pois)};\n`);
    } catch (e) { console.warn('  POI 수집 실패(기존 파일 유지):', e.message); }
  }
  console.log(`완료 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
})().catch((e) => { console.error('오류:', e); process.exit(1); });
