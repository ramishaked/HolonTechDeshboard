#!/usr/bin/env node
/* ── אימות אופליין לדף התמונה החינוכית (BigPicture/index.html) ──────
   האתר שקיפות בחינוך חוסם שרתים מחוץ לישראל, ולכן אין כאן נתונים
   אמיתיים. הבדיקה בונה API מדומה במבנה המדויק שבמדריך הגישה
   (lists · national · rashutHistory · rashut), מריצה עליו את קוד
   האיסוף עצמו (shkifutCollector, מחולץ מהדף), ואת הקובץ שיוצא טוענת
   לדף בדפדפן. כך נבדקים גם האיסוף וגם התצוגה, באותו מסלול שיקרה
   בפועל.

   שימוש:  node tools/bigpicture-check.mjs [--shot]
   --shot שומר צילומי מסך לתיקיית tmp של המערכת.
─────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(HERE, '..', 'BigPicture', 'index.html');
const html = fs.readFileSync(PAGE, 'utf8');
const problems = [];
const fail = m => { problems.push(m); console.error('  ✗ ' + m); };
const pass = m => console.log('  ✓ ' + m);
const SHOT = process.argv.includes('--shot');

/* ── API מדומה ────────────────────────────────────────────────── */
const CITIES = [
  [66001, 'חולון', 1], [62000, 'בת ים', 1], [83006, 'ראשון לציון', 2], [84004, 'רחובות', 2], [86009, 'רמת גן', 1],
  [79004, 'פתח תקווה', 2], [40006, 'חיפה', 3], [72009, 'נס ציונה', 2], [50000, 'תל אביב - יפו', 1], [70001, 'אשדוד', 4],
  [90009, 'באר שבע', 4], [74001, 'נתניה', 2], [64000, 'הרצליה', 1], [69002, 'כפר סבא', 2], [63000, 'גבעתיים', 1],
  [87000, 'רעננה', 2], [26400, 'ראש העין', 2], [26600, 'יבנה', 2], [24000, 'אור יהודה', 1], [65000, 'חדרה', 3],
  [68007, 'קרית אתא', 3], [71000, 'אשקלון', 4], [30001, 'ירושלים', 5], [61000, 'בני ברק', 1], [97000, 'הוד השרון', 2],
  [26200, 'קריית אונו', 1], [94000, 'יהוד-מונוסון', 2], [85000, 'רמלה', 2], [70000, 'לוד', 2], [11111, 'מועצה קטנה', 2],
];
const DIST = { 1: 'תל אביב', 2: 'מרכז', 3: 'חיפה', 4: 'דרום', 5: 'ירושלים' };
const VARS = ['ACHUZ_ZAKAIM', 'ACHUZ_ZAKAIM_MITZTYEN', 'ACHUZ_ZAKAIM_BG_TECH_ANG5', 'ACHUZ_ANGLIT_5YL', 'ACHUZ_ANGLIT_4YL',
  'ACHUZ_MATEM_5YL', 'ACHUZ_MATEM_4YL', 'ACHUZ_ZAK_TECH_KLALI', 'ACHUZ_ZAK_TECH_33', 'ACHUZ_ZAK_TECH_21_31_32_33'];
const HEB = { ACHUZ_ZAKAIM: 'זכאות לבגרות', ACHUZ_ZAKAIM_MITZTYEN: 'בגרות מצטיינת', ACHUZ_ZAKAIM_BG_TECH_ANG5: 'בגרות טק' };
const BASE = { ACHUZ_ZAKAIM: 78, ACHUZ_ZAKAIM_MITZTYEN: 14, ACHUZ_ZAKAIM_BG_TECH_ANG5: 12, ACHUZ_ANGLIT_5YL: 50, ACHUZ_ANGLIT_4YL: 17,
  ACHUZ_MATEM_5YL: 18, ACHUZ_MATEM_4YL: 21, ACHUZ_ZAK_TECH_KLALI: 30, ACHUZ_ZAK_TECH_33: 6, ACHUZ_ZAK_TECH_21_31_32_33: 9 };
// חולון, כפי שהיא מופיעה באתר (מדריך הגישה + הטיוטה לתקשורת): תשפ״ה / תשפ״ד
const HOLON = { 2025: { ACHUZ_ZAKAIM: 82.1, ACHUZ_ZAKAIM_MITZTYEN: 11.6, ACHUZ_ZAKAIM_BG_TECH_ANG5: 14.6, ACHUZ_ANGLIT_5YL: 58.2, ACHUZ_MATEM_5YL: 21.9 },
  2024: { ACHUZ_ZAKAIM: 83.8, ACHUZ_ZAKAIM_MITZTYEN: 9.4, ACHUZ_ZAKAIM_BG_TECH_ANG5: 13.7, ACHUZ_ANGLIT_5YL: 55.3, ACHUZ_MATEM_5YL: 20.7 } };
const NAT = { 2025: { ACHUZ_ZAKAIM: 77.9, ACHUZ_ZAKAIM_MITZTYEN: 14.4, ACHUZ_ZAKAIM_BG_TECH_ANG5: 11.6, ACHUZ_ANGLIT_5YL: 48.7, ACHUZ_MATEM_5YL: 17.1 } };
const rnd = seed => { let x = seed % 2147483647; return () => (x = x * 16807 % 2147483647) / 2147483647; };
const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

function history(semel) {
  const r = rnd(semel), rows = [];
  for (const v of VARS) for (const y of YEARS) for (const cls of [12, 120]) {
    let x = BASE[v] + (r() - .5) * 16 + (y - 2020) * .3;
    if (semel === 66001 && HOLON[y]?.[v] != null) x = HOLON[y][v] + (cls === 120 ? 3 : 0);
    if (semel === 11111 && y < 2024) continue;                 // רשות בלי היסטוריה: "חדש"
    rows.push({ year: y, Class_Id: cls, Entity_id: semel, Var_id: v, Var_Id_Heb: HEB[v] || v, ACHUZ_RASHUTI: +x.toFixed(1) });
  }
  return { rashutAkavish: rows };
}
function api(url) {
  const u = new URL(url, 'https://shkifut.education.gov.il');
  const q = u.searchParams;
  if (u.pathname === '/api/data/lists') {
    const items = [
      ...CITIES.map(([s, n]) => ({ Semel: s, Snif: 0, Shem: n, Address: '', Mode: 2, Date: '' })),
      ...Object.entries(DIST).map(([s, n]) => ({ Semel: +s, Snif: 0, Shem: n, Address: '', Mode: 1, Date: '' })),
      { Semel: 123456, Snif: 0, Shem: 'בית ספר לדוגמה', Address: '', Mode: 3, Date: '' },
    ];
    return { infoLists: Object.fromEntries(items.map((x, i) => [i, x])) };
  }
  if (u.pathname === '/api/data/national/') {
    const rows = [];
    for (const v of VARS) for (const y of YEARS) rows.push({ year: y, Class_Id: 12, Var_id: v, Var_Id_Heb: HEB[v] || v,
      ACHUZ_ARZI: NAT[y]?.[v] ?? +(BASE[v] + (y - 2020) * .4).toFixed(1) });
    // שנת 2026 עוד לא פורסמה: שאילתה עליה מחזירה היסטוריה עד 2025
    return { nationalHistory: { arziAkavish: rows } };
  }
  if (u.pathname === '/api/data/rashutHistory/') return history(+q.get('semelRashut'));
  if (u.pathname === '/api/data/rashut/') {
    const s = +q.get('semelRashut'), c = CITIES.find(x => x[0] === s), r = rnd(s + 7);
    const n12 = s === 66001 ? 2400 : s === 11111 ? 60 : Math.round(500 + r() * 4000);
    return { rashutKlali: [{ SEMEL_RASHUT: s, TALMIDIM_12: n12, TALMIDIM_TECHNOLOGI: s === 66001 ? 47.7 : +(r() * 60).toFixed(1),
      MDD_SAL_ISHI: +(r() * 5).toFixed(1), SEMEL_MACHOZ: c[2], ESHKOL_LAMAS: s === 66001 ? 7 : 5 + (s % 4) }], shichvot: [{ a: 1 }, { a: 2 }] };
  }
  return null;
}

/* ── הרצת קוד האיסוף ב-Node, עם DOM מינימלי ─────────────────────── */
async function runCollector() {
  const m = html.match(/async function shkifutCollector\(\) \{[\s\S]*?\n\}\n/);
  if (!m) { fail('לא נמצאה shkifutCollector בדף'); return null; }
  let downloaded = null; const blobs = new Map();
  const el = () => ({ style: {}, append() {}, appendChild() {}, remove() {}, click() { downloaded = blobs.get(this.href); }, set textContent(v) {}, dir: '' });
  const env = {
    location: { hostname: 'shkifut.education.gov.il' },
    document: { createElement: el, body: { appendChild() {} } },
    fetch: async u => { const b = api(u); return { ok: !!b, status: b ? 200 : 404, json: async () => JSON.parse(JSON.stringify(b)) }; },
    URL: { createObjectURL: b => { const k = 'blob:' + blobs.size; blobs.set(k, b); return k; } },
    Blob, alert: t => fail('alert: ' + t), navigator: {}, window: {}, setTimeout,
  };
  const fn = new Function(...Object.keys(env), `${m[0]}; return shkifutCollector();`);
  const res = await fn(...Object.values(env));
  if (!res?.ok) { fail('האיסוף נכשל: ' + JSON.stringify(res)); return null; }
  pass(`האיסוף: ${res.rashuyot} רשויות, שנה ${res.year}, כשלים ${res.failed}`);
  if (!downloaded) { fail('האיסוף לא הוריד קובץ'); return null; }
  const data = JSON.parse(await downloaded.text());
  data.year === 2025 ? pass('זוהתה שנת הנתונים 2025') : fail(`שנת נתונים ${data.year} במקום 2025`);
  const h = data.rashuyot.find(r => r.s === 66001);
  const z = h?.h?.['12']?.ACHUZ_ZAKAIM?.[data.years.indexOf(2025)];
  z === 82.1 ? pass('חולון, זכאות תשפ״ה בקובץ = 82.1') : fail(`חולון, זכאות בקובץ = ${z}`);
  const n = data.national?.['12']?.ACHUZ_ZAKAIM?.[data.years.indexOf(2025)];
  n === 77.9 ? pass('ארצי, זכאות תשפ״ה בקובץ = 77.9 (שדה ערך שאינו ACHUZ_RASHUTI)') : fail(`ארצי בקובץ = ${n}`);
  const size = JSON.stringify(data).length;
  pass(`גודל הקובץ ${Math.round(size / 1024)}KB ל־${data.rashuyot.length} רשויות`);
  return data;
}

/* ── הדף בדפדפן ───────────────────────────────────────────────── */
async function launch() {
  let chromium;
  for (const pkg of [path.join(HERE, 'node_modules', 'playwright-core', 'index.mjs'), 'playwright-core', 'playwright']) {
    try { ({ chromium } = await import(pkg)); break; } catch { /* הבא */ }
  }
  if (!chromium) { fail('playwright-core לא מותקן: npm install --prefix tools'); return null; }
  for (const p of [null, '/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']) {
    try { return await chromium.launch(p ? { executablePath: p } : {}); } catch { /* הבא */ }
  }
  fail('Chromium לא עלה'); return null;
}

async function openPage(browser, data, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://bp.local/BigPicture/data.json')) return data ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }) : route.fulfill({ status: 404, body: '' });
    if (u.startsWith('http://bp.local/BigPicture/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    return route.abort();
  });
  await page.goto('http://bp.local/BigPicture/');
  await page.waitForTimeout(400);
  return { page, errors };
}

const data = await runCollector();
const browser = data && await launch();
if (browser) {
  const { page, errors } = await openPage(browser, data);
  const t = s => page.locator(s).first().innerText().catch(() => '');
  const k0 = await t('.kpi .v');
  k0.includes('82.1') ? pass('אריח הזכאות מציג 82.1%') : fail(`אריח הזכאות: "${k0}"`);
  const chip = await t('.kpi .chip');
  chip.includes('-1.7') ? pass('שינוי מתשפ״ד: -1.7 (ירידה)') : fail(`שינוי בזכאות: "${chip}"`);
  (await page.locator('.kpi').count()) === 5 ? pass('חמישה מדדי ליבה') : fail('מספר אריחי הליבה שגוי');
  const bars = await page.locator('.bar').count(), me = await page.locator('.bar.me').count();
  bars > 1 && me === 1 ? pass(`קבוצת אשכול: ${bars} רשויות, חולון מסומנת`) : fail(`מוטות: ${bars}, מסומנת: ${me}`);
  const small = await page.locator('.bar .nm', { hasText: 'מועצה קטנה' }).count();
  small === 0 ? pass('סף 200 תלמידי י״ב מסנן רשות קטנה') : fail('רשות קטנה לא סוננה');
  for (const g of ['size', 'region', 'custom', 'cluster']) {
    await page.click(`.pill[data-g="${g}"]`);
    const n = await page.locator('.bar').count(), h = await t('section.card h2');
    n >= 2 ? pass(`קבוצה ${g}: ${n} רשויות · "${h}"`) : fail(`קבוצה ${g}: ${n} רשויות`);
  }
  await page.click('.pill[data-g="region"]');
  const reg = await page.locator('.bar .nm', { hasText: 'חיפה' }).count();
  reg === 0 ? pass('אזור המרכז אינו כולל את חיפה') : fail('חיפה נכללה באזור המרכז');
  await page.click('.pill[data-g="custom"]');
  await page.fill('#addIn', 'חיפה'); await page.click('#addBtn');
  (await page.locator('.tag', { hasText: 'חיפה' }).count()) === 1 ? pass('הוספה ידנית של חיפה') : fail('ההוספה הידנית נכשלה');
  await page.click('.kpi[data-m="ACHUZ_MATEM_5YL"]');
  (await t('section.card h2')).includes('מתמטיקה') ? pass('לחיצה על אריח מחליפה מדד בהשוואה') : fail('האריח לא החליף מדד');
  await page.click('[data-pop="120"]');
  (await page.locator('.ref').count()) === 0 && (await page.locator('tr.nat').count()) === 0
    ? pass('ללא חנ״מ: אין השוואה לארצי') : fail('ללא חנ״מ: ההשוואה לארצי עדיין מוצגת');
  await page.click('[data-pop="12"]');
  (await page.locator('.ref').count()) > 0 ? pass('כלל י״ב: קו הממוצע הארצי מוצג') : fail('קו ארצי חסר');
  await page.selectOption('#citySel', '62000');
  (await t('#title')).includes('בת ים') ? pass('החלפת רשות לבת ים') : fail('בורר הרשות לא עבד');
  /\bcity=62000\b/.test(page.url()) ? pass('הרשות נשמרת בכתובת') : fail('הכתובת לא עודכנה');
  const href = await page.getAttribute('#bmLink', 'href');
  href?.startsWith('javascript:') ? pass(`סימניית האיסוף נוצרה (${Math.round(href.length / 1024)}KB)`) : fail('סימניית האיסוף חסרה');
  if (SHOT) { await page.selectOption('#citySel', '66001'); await page.click('.pill[data-g="cluster"]'); await page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), 'bp-desktop.png'), fullPage: true }); }
  errors.length ? errors.forEach(e => fail('שגיאת קונסול: ' + e)) : pass('קונסול נקי');
  await page.close();

  for (const w of [320, 360, 390, 768]) {
    const mob = await openPage(browser, data, { width: w, height: 844 });
    const check = async tag => {
      const r = await mob.page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        tables: [...document.querySelectorAll('.tbl-wrap')].map(e => e.scrollWidth - e.clientWidth).filter(x => x > 1).length,
        clipped: [...document.querySelectorAll('.kpi, .card, .mini')].filter(e => e.scrollWidth - e.clientWidth > 1).length,
      }));
      r.page <= 0 && !r.clipped ? pass(`${w}px ${tag}: אין גלילה אופקית ואין תוכן חתוך`) : fail(`${w}px ${tag}: דף ${r.page}px, רכיבים חתוכים ${r.clipped}`);
      if (w < 600) r.tables === 0 ? pass(`${w}px ${tag}: הטבלאות מוצגות ככרטיסים, בלי גלילה`) : fail(`${w}px ${tag}: ${r.tables} טבלאות גוללות`);
    };
    await check('אשכול');
    await mob.page.click('.pill[data-g="custom"]'); await check('בחירה ידנית');
    if (w < 600) { await mob.page.click('.sortbar .pill[data-sort="ACHUZ_ANGLIT_5YL"]');
      (await mob.page.locator('.sortbar .pill[aria-pressed="true"]').innerText()).includes('אנגלית') ? pass(`${w}px: מיון מכפתורי המובייל`) : fail(`${w}px: מיון במובייל לא עבד`); }
    if (SHOT && w === 390) { await mob.page.click('.pill[data-g="cluster"]'); await mob.page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), 'bp-mobile.png'), fullPage: true }); }
    mob.errors.forEach(e => fail(`${w}px, שגיאה: ` + e));
    await mob.page.close();
  }

  const emp = await openPage(browser, null);
  (await emp.page.locator('.empty').count()) === 1 && await emp.page.locator('#upd').evaluate(d => d.open)
    ? pass('בלי data.json: מסך ריק עם הוראות עדכון') : fail('מסך הריק לא הוצג');
  emp.errors.forEach(e => fail('ריק, שגיאה: ' + e));
  await browser.close();
}
if (SHOT) console.log('  צילומים: ' + path.join(process.env.SHOT_DIR || os.tmpdir(), 'bp-*.png'));
console.log(problems.length ? `\n${problems.length} בעיות` : '\nהכל תקין');
process.exit(problems.length ? 1 : 0);
