#!/usr/bin/env node
/* ── אימות אופליין לדשבורד ────────────────────────────────────────
   למה זה קיים: סביבת הפיתוח חוסמת את docs.google.com ואת
   cdnjs.cloudflare.com, ולכן index.html פשוט לא יכול לרנדר שם.
   ההנחיה הישנה ("לפתוח בדפדפן ולוודא שהקונסול נקי") לא הייתה ניתנת
   לביצוע, וכל משימה נגמרה בניסיונות כושלים. זה התחליף.

   מה זה עושה:
     1. node --check על בלוק ה-<script> — שער מהיר לשגיאות תחביר
     2. מרים שרת סטטי מקומי ומגיש את index.html כמו שהוא
     3. מיירט את cdnjs → chart-stub.js, ואת הגיליון → tools/fixture.mjs
     4. עובר על כל התצוגות בסיידבר ומוודא שכל אחת מרנדרת תוכן
     5. מצליב את מספרי הסקירה העירונית מול חישוב עצמאי מהפיקסצ׳ר

   מה זה לא עושה: לא נוגע בנתוני חולון האמיתיים. ההצלבה מול §8
   נעשית בדפדפן מול הגיליון החי, ורק למי שיש לו גישה אליו.

   שימוש:
     node tools/verify.mjs            אימות מלא
     node tools/verify.mjs --syntax   רק שער התחביר (ללא דפדפן)
─────────────────────────────────────────────────────────────────── */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PERIODS, DEFAULT_GID, csvFor, expectedFor } from './fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'data', 'national.json');

const problems = [];
const fail = m => { problems.push(m); console.error('  ✗ ' + m); };
const pass = m => console.log('  ✓ ' + m);

const LIVE = process.argv.includes('--live');

// ── מצב --live: הגיליון האמיתי, דרך curl ─────────────────────────
// למה curl ולא fetch ולא הדפדפן: בסביבת ההרצה רק תעבורה שעוברת דרך
// HTTPS_PROXY יוצאת החוצה. `fetch` של Node ו-Chromium (גם עם proxy
// מוגדר) נחסמים — נמדד. לכן ה-CSV נשלף כאן ומוזרק לדף ביירוט,
// בדיוק כמו הפיקסצ׳ר. הדפדפן עצמו לא נוגע ברשת בשום מצב.
const _liveCache = new Map();
function liveCsv(gid) {
  if (_liveCache.has(gid)) return _liveCache.get(gid);
  const html = fs.readFileSync(PAGE, 'utf8');
  const m = html.match(/const PUB\s*=\s*'([^']+)'\s*\+\s*\n?\s*'([^']+)'/);
  const pub = m ? m[1] + m[2] : null;
  if (!pub) { fail('לא הצלחתי לחלץ את PUB מ-index.html'); return null; }
  const url = `${pub}?output=csv&single=true${gid ? '&gid=' + gid : ''}`;
  try {
    const out = execFileSync('curl', ['-sS', '-L', '--max-time', '40', url], { maxBuffer: 32e6 }).toString();
    if (/^\s*<(!DOCTYPE|html)/i.test(out)) { fail(`gid ${gid}: התקבל HTML במקום CSV`); return null; }
    _liveCache.set(gid, out);
    return out;
  } catch (e) {
    fail(`gid ${gid}: שליפה חיה נכשלה — ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

// ── מפת פונקציות — נגזרת מהקובץ, לא כתובה ביד ────────────────────
// מפה סטטית ב-CLAUDE.md התיישנה תוך שעה (תצוגה נוספה, שלוש nt* הוסרו),
// והייתה מגנט להתנגשויות בין סשנים מקבילים. הגזירה כאן לא יכולה להתיישן.
const MAP_GROUPS = [
  [/^(renderYY|yy)/,             'השוואה שנתית (תצוגה 8)'],
  [/^render/,                    'רינדור תצוגה'],
  [/^nt/,                        'ערים אחרות (תצוגות 9–10)'],
  [/^ft/,                        'עתיד טק (תצוגה 7)'],
  [/^tr[A-Z]/,                   'מגמות לאורך תקופות'],
  [/^(city|studentsAtGrade)/,    'מדד ומכנה עירוני'],
  [/^school/,                    'בית ספר בודד'],
  [/^(boot|fetch|csvParse|parseSheet|applyPeriod|withPeriod|periodsSorted|parsePeriodName)/,
                                 'טעינה, פרסינג ותקופות'],
  [/^(switchView|destroyChart|refLine|initDeepDive)/, 'ניווט וגרפים'],
];

function functionMap() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const names = new Set();
  for (const m of html.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  for (const m of html.matchAll(/^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm)) names.add(m[1]);

  const build = html.match(/const BUILD\s*=\s*'([^']+)'/);
  const lines = html.split('\n').length;
  console.log(`\nמפת פונקציות — ${build ? build[1] : '?'} · ${lines} שורות · ${names.size} פונקציות`);
  console.log('נגזר מ-index.html בזמן ריצה. אין כאן שום שם צרוב.\n');

  const left = new Set(names);
  for (const [re, title] of MAP_GROUPS) {
    const hit = [...left].filter(n => re.test(n)).sort();
    if (!hit.length) continue;
    hit.forEach(n => left.delete(n));
    console.log(`${title} (${hit.length})`);
    console.log('  ' + hit.join(' · ') + '\n');
  }
  const rest = [...left].sort();
  if (rest.length) console.log(`עזרים (${rest.length})\n  ` + rest.join(' · ') + '\n');
}

// ── 1. שער התחביר ────────────────────────────────────────────────
function syntaxGate() {
  console.log('\n── תחביר ──');
  const html = fs.readFileSync(PAGE, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  if (!blocks.length) { fail('לא נמצא בלוק <script> פנימי ב-index.html'); return; }

  blocks.forEach((m, i) => {
    // הקוד נבדק בקובץ זמני, אבל מספרי השורות מתורגמים חזרה ל-index.html —
    // אחרת ההודעה מצביעה על נתיב ב-/tmp ואי אפשר לקפוץ אליה.
    const offset = html.slice(0, m.index + m[0].indexOf(m[1])).split('\n').length - 1;
    const tmp = path.join(os.tmpdir(), `holon-script-${process.pid}-${i}.js`);
    fs.writeFileSync(tmp, m[1]);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
      pass(`בלוק ${i + 1}/${blocks.length} — ${m[1].split('\n').length} שורות, תחביר תקין`);
    } catch (e) {
      const out = (e.stderr || e.stdout || '').toString()
        .replace(new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)', 'g'),
                 (_, n) => `index.html:${Number(n) + offset}`)
        .split('\n').slice(0, 6).join('\n');
      fail(`בלוק ${i + 1} — שגיאת תחביר:\n${out}`);
    } finally { fs.rmSync(tmp, { force: true }); }
  });

  // BUILD חייב להיות שם — הוא מה שמאפשר לדעת איזו גרסה רצה בדפדפן
  const b = html.match(/const BUILD\s*=\s*'([^']+)'/);
  if (b) pass(`BUILD = ${b[1]}`); else fail('לא נמצא const BUILD');
}

// ── 2. שרת סטטי ──────────────────────────────────────────────────
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                  '.css': 'text/css; charset=utf-8' };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

// ── 3. דפדפן ─────────────────────────────────────────────────────
async function launch(chromium) {
  const paths = [null, '/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  let last;
  for (const p of paths) {
    try { return await chromium.launch(p ? { executablePath: p } : {}); }
    catch (e) { last = e; }
  }
  throw last;
}

async function browserRun() {
  let chromium;
  for (const pkg of ['playwright-core', 'playwright']) {
    try { ({ chromium } = await import(pkg)); break; } catch { /* הבא בתור */ }
  }
  if (!chromium) {
    console.error('\nplaywright-core לא מותקן. הרץ:  npm install --prefix tools');
    process.exit(2);
  }

  const stub = fs.readFileSync(path.join(HERE, 'chart-stub.js'), 'utf8');
  const { srv, port } = await serve();
  const browser = await launch(chromium);
  const page = await browser.newPage();

  const noise = [];
  page.on('console', m => { if (m.type() === 'error') noise.push('console.error: ' + m.text()); });
  page.on('pageerror', e => noise.push('pageerror: ' + e.message));

  // סדר הרישום חשוב: Playwright בודק את המסלולים מהאחרון לראשון,
  // ולכן ה-catch-all נרשם ראשון והספציפיים אחריו.
  // כל יעד חיצוני שאינו מוכר = תלות חדשה שנוספה בלי שנשים לב.
  const strays = new Set();
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname === '127.0.0.1') return r.continue();
    strays.add(u.origin);
    r.abort();
  });

  // הגופן — מוגש ריק. הדשבורד נופל חזרה לגופן מערכת, וזה לא מה שנבדק כאן.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r =>
    r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '/* offline */' }));

  // cdnjs חסום כאן — מגישים סטאב במקום Chart.js ותוסף התוויות
  await page.route('**/cdnjs.cloudflare.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: stub }));

  // שירות השאלות (תצוגה 13, v83) — התלות החיצונית היחידה מעבר לגיליון.
  // כאן הוא נענה בתשובה קבועה: מה שנבדק הוא שהדף בונה חבילה, שולח,
  // ומציג — לא המודל. הכתובת האמיתית ב-`ASK_URL` שבדף.
  await page.route('**/*.vercel.app/**', r => {
    const m = r.request().method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    let q = '';
    try { q = JSON.parse(r.request().postData() || '{}').question || ''; } catch (_) {}
    r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: cors,
                body: JSON.stringify({ answer: 'תשובת בדיקה לשאלה: ' + q }) });
  });

  // הגיליון — הדפדפן לא מגיע אליו בשום מקרה (ראה liveCsv), ולכן ה-CSV
  // תמיד מוגש דרך היירוט. במצב רגיל הוא סינתטי; ב---live הוא האמיתי.
  const served = new Set();
  await page.route('**/docs.google.com/**', async r => {
    const gid = new URL(r.request().url()).searchParams.get('gid') || '';
    let body;
    if (LIVE) {
      body = liveCsv(gid);
      if (body == null) return r.fulfill({ status: 502, body: 'live fetch failed for gid ' + gid });
    } else {
      if (!PERIODS.find(x => x.gid === gid)) return r.fulfill({ status: 404, body: 'no fixture for gid ' + gid });
      body = csvFor(gid);
    }
    served.add(gid);
    r.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8',
                headers: { 'access-control-allow-origin': '*' }, body });
  });

  console.log('\n── טעינה ──');
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => (document.getElementById('dataStamp')?.textContent || '').trim().length > 0,
      { timeout: 25000 });
  } catch {
    const msg = await page.evaluate(() => document.querySelector('.err-box, #loadSub')?.innerText || '');
    fail('boot() לא סיים בזמן. מה שהמסך הראה: ' + msg.replace(/\s+/g, ' ').slice(0, 300));
    await browser.close(); srv.close();
    return;
  }

  // boot() תופס כל שגיאה ומחליף את <main> במסך שגיאה. בלי הבדיקה הזו
  // התסמין ("אין section#view-…") היה מוצג במקום הסיבה.
  const errBox = await page.evaluate(() =>
    document.querySelector('.err-box')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) || null);
  if (errBox || noise.length) {
    if (errBox) fail('הדשבורד הציג מסך שגיאה במקום להיטען: ' + errBox);
    else fail(`${noise.length} שגיאות כבר בטעינה`);
    [...new Set(noise)].slice(0, 5).forEach(n => console.error('  ! ' + n));
    await browser.close(); srv.close();
    return;
  }

  if (LIVE) pass(`נטענו ${served.size} תקופות מהגיליון האמיתי`);
  else if (served.size === PERIODS.length) pass(`נטענו ${served.size} תקופות מהפיקסצ׳ר`);
  else fail(`נטענו ${served.size} תקופות מתוך ${PERIODS.length}`);

  const stamp = await page.textContent('#dataStamp');
  pass('חותמת: ' + stamp.replace(/\s+/g, ' ').trim());

  // ── 4. כל התצוגות מרנדרות ──────────────────────────────────────
  console.log('\n── תצוגות ──');
  const views = await page.$$eval('.sb-item[data-view]', els =>
    els.map(e => ({ id: e.dataset.view, label: e.innerText.replace(/\s+/g, ' ').trim() })));
  // תצוגות המשך (העמקה, טבלת הרשויות) אינן בתפריט בכוונה — נכנסים אליהן
  // מתוך עמוד ההורה. המפה נקראת מהדף עצמו כדי שלא תתיישן כאן.
  const parents = await page.evaluate(() =>
    (typeof PARENT_OF !== 'undefined') ? PARENT_OF : {});
  const kids = Object.keys(parents).map(id => ({ id, parent: parents[id], child: true }));

  // מספר התצוגות נגזר מהדף ולא צרוב כאן — אחרת הבדיקה מתיישנת בכל תצוגה
  // חדשה. מה שכן נבדק: לכל section.view יש דרך להגיע — מהתפריט או מההורה.
  const sections = await page.$$eval('section.view', els => els.length);
  if (views.length + kids.length !== sections)
    fail(`${sections} section.view בדף אבל ${views.length} פריטי סיידבר ו-${kids.length} תצוגות המשך — תצוגה בלי כניסה?`);
  else pass(`${views.length} בסיידבר + ${kids.length} תצוגות המשך = ${sections} section.view`);

  for (const v of [...views, ...kids]) {
    const before = noise.length;
    if (v.child) {
      // הכניסה נבדקת דרך הרכיב האמיתי שבעמוד ההורה, לא ב-switchView ישיר —
      // כך "אין פריט בתפריט" לא הופך בשקט ל"אין דרך להגיע".
      await page.click(`.sb-item[data-view="${v.parent}"]`);
      await page.waitForTimeout(150);
      const hit = await page.evaluate(({ id, parent }) => {
        const re = new RegExp(`switchView\\(['"]${id}['"]\\)|goTo${id}`, 'i');
        const el = [...document.querySelectorAll(`#view-${parent} [onclick]`)]
          .find(e => re.test(e.getAttribute('onclick')));
        if (!el) return false;
        el.click();
        return true;
      }, { id: v.id, parent: v.parent });
      if (!hit) { fail(`${v.id}: אין כניסה מתוך #view-${v.parent}`); continue; }
    } else {
      await page.click(`.sb-item[data-view="${v.id}"]`);
    }
    await page.waitForTimeout(150);
    const info = await page.evaluate(id => {
      const el = document.getElementById('view-' + id);
      if (!el) return null;
      return {
        active: el.classList.contains('active'),
        chars: el.innerText.replace(/\s+/g, ' ').trim().length,
        dashes: (el.innerText.match(/—/g) || []).length,
        canvases: el.querySelectorAll('canvas').length,
      };
    }, v.id);

    if (!info)            fail(`${v.id}: אין section#view-${v.id}`);
    else if (!info.active) fail(`${v.id}: התצוגה לא הפכה לפעילה בלחיצה`);
    else if (info.chars < 80) fail(`${v.id}: רונדרו רק ${info.chars} תווים — כנראה ריקה`);
    else if (noise.length > before) fail(`${v.id}: ${noise.length - before} שגיאות קונסול`);
    else pass(`${v.id} — ${info.chars} תווים · ${info.canvases} קנבסים`);
  }

  const charts = await page.evaluate(() => (window.__CHARTS_BUILT__ || []).length);
  if (charts > 0) pass(`${charts} גרפים נבנו`); else fail('אף גרף לא נבנה');

  // ── 4ב. הנתון הגולמי מול data/national.json ────────────────────
  // הקבועים הארציים חייבים להיות צרובים ב-index.html (כלל "קובץ אחד"),
  // ולכן data/national.json הוא עותק. עותק שאיש אינו בודק מתיישן — כאן
  // הוא נבדק. הערכים נקראים מהדף החי ולא ב-regex.
  console.log('\n── נתון גולמי (data/national.json) ──');
  if (!fs.existsSync(DATA)) fail('data/national.json חסר');
  else {
    const ref = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const live = await page.evaluate(() => ({
      NAT, NAT_2014, NAT_GIRLS_2024, HOLON_MOE, HOLON_HIST, HOLON_MID,
      HOLON_POT_2024, CITY_DATA, CITY_ASTERISK, CITY_NEAR, POP_BAND,
    }));
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const nat = ref['ארצי_סדרות'], g = ref['ארצי_שיעור_תלמידות_2024'], c = ref['רשויות'];
    const checks = [
      ['שנים',            live.NAT.years, nat['שנים']],
      ['בגרות הייטק',     live.NAT.tech,  nat['בגרות_הייטק']],
      ['מתמטיקה 5',       live.NAT.ma5,   nat['מתמטיקה_5']],
      ['פיזיקה 5',        live.NAT.ph,    nat['פיזיקה_5']],
      ['מדעי המחשב 5',    live.NAT.cs,    nat['מדעי_המחשב_5']],
      ['אנגלית 5',        live.NAT.en5,   nat['אנגלית_5']],
      ['עוגן 2014',       [live.NAT_2014.tech, live.NAT_2014.ma5],
                          [ref['ארצי_עוגן_2014'].tech, ref['ארצי_עוגן_2014'].ma5]],
      ['שיעור תלמידות 2024',
        [live.NAT_GIRLS_2024.tech, live.NAT_GIRLS_2024.ma5, live.NAT_GIRLS_2024.ph, live.NAT_GIRLS_2024.cs],
        [g['בגרות_הייטק']['אחוז'], g['מתמטיקה_5']['אחוז'], g['פיזיקה_5']['אחוז'], g['מדעי_המחשב_5']['אחוז']]],
      ['חולון — משה"ח',   [live.HOLON_MOE.years, live.HOLON_MOE.tech, live.HOLON_MOE.ma5],
        [ref['חולון_סדרות']['רשמי_משהח']['שנים'], ref['חולון_סדרות']['רשמי_משהח']['בגרות_הייטק'],
         ref['חולון_סדרות']['רשמי_משהח']['מתמטיקה_5']]],
      ['חולון — פירוק הפוטנציאל',
        [live.HOLON_POT_2024.phcs, live.HOLON_POT_2024.ma5, live.HOLON_POT_2024.en5,
         live.HOLON_POT_2024.year],
        [ref['חולון_פוטנציאל_2024']['חסרים_רק_פיזיקה_או_מדעי_המחשב'],
         ref['חולון_פוטנציאל_2024']['חסרים_רק_מתמטיקה_5'],
         ref['חולון_פוטנציאל_2024']['חסרים_רק_אנגלית_5'],
         ref['חולון_פוטנציאל_2024']['שנה']]],
      ['33 רשויות',       live.CITY_DATA, c['שורות']],
      ['כוכבית',          live.CITY_ASTERISK, c['כוכבית']],
      ['רצועת גודל',      live.POP_BAND, c['רצועת_גודל']],
    ];
    let bad = 0;
    for (const [name, a, b] of checks) if (!eq(a, b)) { fail(`${name}: index.html ≠ data/national.json`); bad++; }
    if (!bad) pass(`${checks.length} קבוצות ערכים זהות בין index.html ל-data/national.json`);

    // שיעור התלמידות חייב לצאת מהמספרים המוחלטים שבאותו מקור
    for (const k of ['בגרות_הייטק', 'מתמטיקה_5', 'פיזיקה_5', 'מדעי_המחשב_5']) {
      const r = g[k], calc = +(r['תלמידות'] / r['זכאים'] * 100).toFixed(1);
      if (Math.abs(calc - r['אחוז']) > 0.1) fail(`${k}: ${r['תלמידות']}/${r['זכאים']} = ${calc}% ולא ${r['אחוז']}%`);
    }
    pass('שיעורי התלמידות 2024 נגזרים מהמספרים המוחלטים שבדו"ח');
  }

  // ── 5. מספרים ──────────────────────────────────────────────────
  await page.click('.sb-item[data-view="overview"]');
  await page.waitForTimeout(150);

  const num = s => { const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const got = await page.evaluate(() => {
    const t = id => (document.getElementById(id)?.textContent || '').trim();
    return { schools: t('metaSchools'), tech: t('metaTotal'),
             p10: t('kPct10'), p11: t('kPct11'), p12: t('k12Pct'), drop: t('kDrop') };
  });

  // ── תצוגה 11: האקורדיאון והמסקנות ──────────────────────────────
  // הבלוקים מתקפלים, ו**הכותרת הסגורה נושאת את המסקנה** — ולכן `.card-sub`
  // ריק הוא רגרסיה שקטה: המסך ייראה תקין ופשוט לא יאמר כלום.
  // `querySelectorAll` עובד גם על `<details>` סגור, ואין צורך לפתוח.
  const acc = await page.evaluate(
    '(function(){return [].slice.call(document.querySelectorAll("#exBody details.card")).map(function(d){' +
    ' var t=d.querySelector(".card-title"), s=d.querySelector(".card-sub");' +
    ' return {blk:d.dataset.blk||"", open:d.open,' +
    '         title:t?t.textContent.trim():"", lede:s?s.textContent.trim():""};});})()');
  if (acc.length < 6) fail(`תצוגה 11: ${acc.length} בלוקים מתקפלים במקום 6`);
  else {
    const mute = acc.filter(a => !a.lede);
    const anon = acc.filter(a => !a.blk);
    if (mute.length) fail(`תצוגה 11: כותרת סגורה בלי מסקנה — ${mute.map(a => a.title).join(', ')}`);
    else if (anon.length) fail(`תצוגה 11: בלוק בלי data-blk — המצב לא יישמר`);
    else if (acc.some(a => a.open)) fail(`תצוגה 11: בלוק נפתח בברירת מחדל — ${acc.filter(a=>a.open).map(a=>a.title).join(', ')}`);
    else pass(`תצוגה 11 — ${acc.length} בלוקים מתקפלים, כולם סגורים ועם מסקנה בכותרת`);
  }

  // כרטיס "היכן טמון הפוטנציאל" (v66, החליף את "איך מגיעים ליעד") —
  // נקרא **מה-DOM ולא מהנוסחה**: המספר הגדול, טבלת הפעולה ותאיה.
  const pot = await page.evaluate(
    '(function(){var d=document.querySelector("#exBody details.card[data-blk=pot]");' +
    ' if(!d) return null;' +
    ' var n=d.querySelector(".pot-num"), rows=[].slice.call(d.querySelectorAll("tbody tr"));' +
    ' return { num:n?n.textContent.trim():"", rows:rows.length,' +
    '   cells:rows.map(function(r){return [].slice.call(r.querySelectorAll("td"))' +
    '     .map(function(c){return c.textContent.trim();}).join(" | ");}) };})()');
  if (!pot) fail('תצוגה 11: כרטיס "היכן טמון הפוטנציאל" לא נבנה');
  else if (!/^[\d,.]+$/.test(pot.num) || Number(pot.num.replace(/,/g, '')) <= 0)
    fail(`תצוגה 11: מספר הפוטנציאל ריק או אפס — "${pot.num}"`);
  else if (pot.rows < 2) fail(`תצוגה 11: טבלת הפעולה בכרטיס הפוטנציאל ריקה (${pot.rows} שורות)`);
  else if (pot.cells.some(t => /NaN|undefined/.test(t)))
    fail(`תצוגה 11: תא שבור בטבלת הפעולה — ${pot.cells.find(t => /NaN|undefined/.test(t))}`);
  else pass(`תצוגה 11 — כרטיס הפוטנציאל: ${pot.num} תלמידים, טבלת פעולה עם ${pot.rows - 1} בתי ספר`);

  // מצב האקורדיאון חייב לשרוד רינדור מחדש. `renderExec` בונה מחדש את כל
  // `#exBody`, ולכן עד v61 שני הבלוקים המתקפלים התקפלו בחזרה בכל מעבר
  // תצוגה — באג שקט שרק אינטראקציה תופסת.
  if (acc.length >= 6) {
    // הכפתור יושב בתוך `#view-exec`, שמוסתר כשהתצוגה אינה הפעילה —
    // צריך להדליק אותה לפני הלחיצה, ולהחזיר את המצב בסוף.
    await page.click('.sb-item[data-view="exec"]');
    await page.waitForTimeout(120);
    await page.click('#exAll');
    await page.waitForTimeout(60);
    const opened = await page.evaluate(
      '(function(){var d=document.querySelectorAll("#exBody details.card");' +
      ' return {n:d.length, open:[].slice.call(d).filter(function(x){return x.open;}).length,' +
      '         saved:(JSON.parse(localStorage.getItem("holon_exec_open"))||[]).length,' +
      '         btn:(document.getElementById("exAll")||{}).textContent};})()');
    if (opened.open !== opened.n) fail(`תצוגה 11: "פתח הכל" פתח ${opened.open} מתוך ${opened.n}`);
    else if (opened.saved !== opened.n) fail(`תצוגה 11: נשמרו ${opened.saved} פתוחים מתוך ${opened.n}`);
    else if (!/כווץ/.test(opened.btn || '')) fail(`תצוגה 11: הכפתור לא התהפך ל"כווץ הכל" (${opened.btn})`);
    else {
      // מעבר החוצה וחזרה — הרינדור נבנה מאפס, והמצב חייב לחזור מ-localStorage
      await page.click('.sb-item[data-view="overview"]');
      await page.waitForTimeout(80);
      await page.click('.sb-item[data-view="exec"]');
      await page.waitForTimeout(120);
      const back = await page.evaluate(
        '(function(){var d=document.querySelectorAll("#exBody details.card");' +
        ' return [].slice.call(d).filter(function(x){return x.open;}).length;})()');
      if (back !== opened.n) fail(`תצוגה 11: אחרי רינדור מחדש נשארו ${back} פתוחים מתוך ${opened.n}`);
      else pass('תצוגה 11 — "פתח הכל" עובד והמצב שורד רינדור מחדש');
    }
    await page.click('.sb-item[data-view="overview"]');   // להחזיר את המצב
    await page.waitForTimeout(80);
  }

  // ── תצוגה 13: חבילת המדדים ושליחה ──────────────────────────────
  // החבילה חייבת להסתרלז, להכיל את כל בתי הספר של התקופה, ולהסכים עם
  // הנוסחאות שהיא אורזת — כאן: מדד יב׳ במצבת מול `cityPctAlt(2)`.
  const ask = await page.evaluate(
    '(function(){var p=buildAskPayload(); var j=askJson(p); var cur=p.periods.filter(function(x){return x.key===CURRENT_PERIOD})[0];' +
    ' return {bytes:j.length, nPer:p.periods.length, nSch:cur?cur.schools.length:-1, sch:SCHOOLS.length,' +
    ' p12:cur&&cur.city["יב"]?cur.city["יב"].techPctMatz:null, ref:cityPctAlt(2), sorted: j.indexOf(\'"build"\') < j.indexOf(\'"periods"\'), url: ASK_URL};})()');
  if (ask.nSch !== ask.sch) fail(`תצוגה 13 — החבילה מכילה ${ask.nSch} בתי ספר במקום ${ask.sch}`);
  else if (ask.nPer < 1 || ask.bytes > 400 * 1024) fail(`תצוגה 13 — חבילה ${ask.nPer} תקופות, ${ask.bytes} בייט`);
  else if (ask.p12 != null && ask.ref != null && Math.abs(ask.p12 - ask.ref) > 0.06)
    fail(`תצוגה 13 — מדד יב׳ במצבת בחבילה ${ask.p12} מול ${ask.ref.toFixed(1)} בדף`);
  else if (!ask.sorted) fail('תצוגה 13 — מפתחות החבילה אינם ממוינים (מטמון)');
  else pass(`תצוגה 13 — חבילה: ${ask.nPer} תקופות · ${ask.nSch} בתי ספר · ${(ask.bytes / 1024).toFixed(0)}KB · מדד יב׳ במצבת ${ask.p12 ?? '—'}`);

  // ── תצוגה 14: צפי מחזור ────────────────────────────────────────
  // הצפי מוצלב מול חישוב עצמאי על השורות הגולמיות (לא דרך `fcCity`),
  // ונבדק שהאקורדיאון של בתי הספר סגור בברירת מחדל.
  await page.click('.sb-item[data-view="forecast"]');
  await page.waitForTimeout(200);
  const fc = await page.evaluate("(function(){\n  var c = fcCity(); if(!c) return {skip:true};\n  // \u05d7\u05d9\u05e9\u05d5\u05d1 \u05e2\u05e6\u05de\u05d0\u05d9 \u05de\u05d4\u05e9\u05d5\u05e8\u05d5\u05ea \u05d4\u05d2\u05d5\u05dc\u05de\u05d9\u05d5\u05ea: \u05dc\u05d0 \u05d3\u05e8\u05da fcCity \u05d5\u05dc\u05d0 \u05d3\u05e8\u05da cityTotal.\n  var yp = yyPeriods(), A = yp.pair[0].key, B = yp.pair[1].key;\n  function raw(key, g){ return ALLDATA[key].schools.reduce(function(a,s){\n    var r = s.grades[g]; return a + (r ? r[4] : 0); }, 0); }\n  var r10 = Math.min(1, raw(B,'\u05d9\u05d0')/raw(A,'\u05d9')), r11 = Math.min(1, raw(B,'\u05d9\u05d1')/raw(A,'\u05d9\u05d0'));\n  var cur = CURRENT_PERIOD;\n  var exp1 = raw(cur,'\u05d9\u05d0') * r11, exp2 = raw(cur,'\u05d9') * r10 * r11;\n  var closed = !document.querySelector('#fcBody details.card[open]');\n  var sub = (document.getElementById('fcSub').textContent || '').length;\n  return { y1: c.y1.ht, y2: c.y2.ht, exp1: Math.round(exp1), exp2: Math.round(exp2),\n           mono: c.y1.year === c.now.year + 1 && c.y2.year === c.now.year + 2,\n           nSch: fcSchools(c.R).length, closed: closed, sub: sub,\n           overCap: fcSchools(c.R).filter(function(x){ return x.y2 != null && x.now != null && x.rate > 1 && x.y2 > x.now * 1.6 * 1.6; }).length };\n})()");
  if (fc.skip) pass('תצוגה 14 — אין שתי דגימות סוף-שנה בפיקסצ׳ר, הצפי לא נבדק');
  else if (Math.abs(fc.y1 - fc.exp1) > 1 || Math.abs(fc.y2 - fc.exp2) > 1)
    fail(`תצוגה 14 — הצפי ${fc.y1}/${fc.y2} מול חישוב עצמאי ${fc.exp1}/${fc.exp2}`);
  else if (!fc.mono) fail('תצוגה 14 — שנות הצפי אינן השנה הבאה והשנה שאחריה');
  else if (!fc.closed) fail('תצוגה 14 — אקורדיאון בתי הספר פתוח בברירת מחדל');
  else if (fc.overCap) fail(`תצוגה 14 — ${fc.overCap} בתי ספר עם היטל שלא הוגבל ל-100%`);
  else pass(`תצוגה 14 — צפי ${fc.y1}/${fc.y2} זכאים · ${fc.nSch} בתי ספר · האקורדיאון סגור`);

  // לחיצה אמיתית על הכפתור — רק כשיש כתובת שירות. ה-route למעלה עונה.
  if (ask.url) {
    await page.click('.sb-item[data-view="ask"]');
    await page.waitForTimeout(150);
    await page.fill('#askQ', 'בדיקה');
    await page.click('#askBtn');
    try {
      await page.waitForFunction(
        () => (document.querySelector('#askA .insight-b')?.textContent || '').includes('תשובת בדיקה'), { timeout: 8000 });
      pass('תצוגה 13 — שאלה נשלחה והתשובה הוצגה');
      // שאלת המשך אחת (v87): השדה נפתח אחרי התשובה, נסגר אחרי תשובת ההמשך.
      const fOpen = await page.evaluate(() => document.getElementById('askF').style.display !== 'none');
      if (!fOpen) fail('תצוגה 13 — שדה שאלת ההמשך לא נפתח אחרי התשובה');
      else {
        await page.fill('#askFQ', 'ולמה?');
        await page.click('#askFBtn');
        await page.waitForFunction(
          () => (document.querySelector('#askA2 .insight-b')?.textContent || '').includes('תשובת בדיקה לשאלה: ולמה?'), { timeout: 8000 });
        const fClosed = await page.evaluate(() => document.getElementById('askF').style.display === 'none');
        if (fClosed) pass('תצוגה 13 — שאלת המשך אחת נענתה והשדה נסגר');
        else fail('תצוגה 13 — שדה ההמשך נשאר פתוח אחרי תשובת ההמשך (צ\'אט)');
      }
    } catch (_) {
      fail('תצוגה 13 — התשובה לא הוצגה: ' + (await page.evaluate(() => document.querySelector('#askA')?.innerText || '')));
    }
  } else {
    pass('תצוגה 13 — ASK_URL ריק, הכפתור מנוטרל (השליחה לא נבדקה)');
  }

  if (LIVE) {
    // אין מול מה להשוות אוטומטית — הערכים ב-§8 נמדדו בתאריך מסוים
    // והגיליון חי. מדפיסים אותם להצלבה ידנית מול §8, וזה כל התפקיד.
    const per = await page.evaluate(
      '(function(){var o={};Object.keys(ALLDATA).forEach(function(k){o[ALLDATA[k].label]=ALLDATA[k].schools.length});' +
      ' return {periods:o, current:ALLDATA[CURRENT_PERIOD].label};})()');
    console.log('\n── מספרים חיים מהגיליון — להצלבה מול §8 ──');
    console.log(`  תקופה מוצגת   ${per.current}`);
    Object.entries(per.periods).forEach(([l, n]) => console.log(`    ${l} — ${n} בתי ספר`));
    console.log(`  מספר בתי ספר  ${got.schools}`);
    console.log(`  סך תלמידי טק  ${got.tech}`);
    console.log(`  מדד י׳        ${got.p10.replace(/\s+/g, ' ')}`);
    console.log(`  מדד יא׳       ${got.p11.replace(/\s+/g, ' ')}`);
    console.log(`  מדד יב׳       ${got.p12.replace(/\s+/g, ' ')}`);
    console.log(`  נשירה י׳→יב׳  ${got.drop.replace(/\s+/g, ' ')}`);
    // שורת `focus` ("איך מגיעים ליעד") הוסרה — הכרטיס `execFocus` נמחק
    // ב-v66 והמשתנה כבר לא נאסף; ההפניה שנשארה הפילה כל ריצת --live.
    // המסך הסגור הוא התקציר עצמו — ולכן שש שורות המסקנה הן הפלט שצריך
    // להצליב, לא פחות מהמדדים שמעליהן.
    if (acc.length) {
      console.log('  התקציר במצב סגור:');
      acc.forEach(a => console.log(`    ${a.title} — ${a.lede}`));
    }
    console.log('\n  ⚠ אלה נתוני אמת. §8 נמדד בתאריך מסוים — הפרש אינו בהכרח באג.');
  } else {
    console.log('\n── מספרים (מול חישוב עצמאי מהפיקסצ׳ר) ──');
    const exp = expectedFor(DEFAULT_GID);
    const cmp = (label, actual, expected, tol = 0.05) => {
      const a = num(actual);
      if (Number.isNaN(a)) return fail(`${label}: לא נמצא מספר במסך ("${actual}")`);
      if (Math.abs(a - expected) > tol) fail(`${label}: במסך ${a}, ציפינו ל-${expected.toFixed(2)}`);
      else pass(`${label} = ${a}`);
    };
    cmp('מספר בתי ספר', got.schools, exp.schools, 0);
    cmp('סך תלמידי טק', got.tech, exp.techTotal, 0);
    cmp('מדד י׳', got.p10, exp.p10);
    cmp('מדד יא׳', got.p11, exp.p11);
    cmp('מדד יב׳', got.p12, exp.p12);
    cmp('נשירה י׳→יב׳', got.drop, exp.drop);

    // §3.1 — שורת 'סה"כ עיר' בפיקסצ׳ר מכילה 99999 בכוונה.
    // אם המספר הזה הגיע למסך, הדשבורד קורא את שורת הסיכום במקום לחשב.
    const leaked = await page.evaluate(() => document.body.innerText.includes('99999'));
    if (leaked) fail('§3.1 נשבר — הערך 99999 משורת "סה"כ עיר" הופיע במסך');
    else pass('§3.1 — שורת "סה״כ עיר" לא דלפה למסך');

    // amat: בגמא ט׳ פיזיקה=מדמ״ח=זכאות → קו אחד, לא שלושה.
    // SCHOOLS מוצהר ב-let, כלומר יושב ב-global lexical scope ולא על window.
    const state = await page.evaluate(
      '({ gid: ALLDATA[CURRENT_PERIOD].gid,' +
      '   amat: ALLDATA[CURRENT_PERIOD].schools.find(s=>s.name==="חטיבת גמא").grades["ט"][8] })');
    if (state.gid === DEFAULT_GID) pass('הדף נפתח על התקופה האחרונה');
    else fail(`הדף נפתח על gid ${state.gid}, ציפינו ל-${DEFAULT_GID} (התקופה האחרונה)`);
    if (state.amat === 1) pass('amat זוהה בחטיבת גמא, שכבה ט׳');
    else fail(`amat לא זוהה (קיבלנו ${state.amat}) — הכלל בפרסר השתנה?`);
  }

  if (strays.size) fail('תלות חיצונית לא מוכרת: ' + [...strays].join(', '));
  else pass('אין תלויות חיצוניות מעבר לגיליון, cdnjs והגופן');

  if (noise.length) {
    console.log('\n── רעש קונסול ──');
    noise.forEach(n => console.error('  ! ' + n));
  }

  await browser.close();
  srv.close();
}

// ── main ─────────────────────────────────────────────────────────
if (process.argv.includes('--map')) { functionMap(); process.exit(0); }

syntaxGate();
if (!process.argv.includes('--syntax')) {
  if (problems.length) console.error('\nשער התחביר נכשל — לא מריצים דפדפן.');
  else await browserRun();
}

console.log('');
if (problems.length) {
  console.error(`נכשל: ${problems.length} בעיות.`);
  process.exit(1);
}
console.log('הכל עבר.');
