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

const problems = [];
const fail = m => { problems.push(m); console.error('  ✗ ' + m); };
const pass = m => console.log('  ✓ ' + m);

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

  // הגיליון חסום כאן — מגישים CSV סינתטי לפי ה-gid שבבקשה
  const served = new Set();
  await page.route('**/docs.google.com/**', r => {
    const gid = new URL(r.request().url()).searchParams.get('gid') || '';
    const p = PERIODS.find(x => x.gid === gid);
    if (!p) return r.fulfill({ status: 404, body: 'no fixture for gid ' + gid });
    served.add(gid);
    r.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8',
                headers: { 'access-control-allow-origin': '*' }, body: csvFor(gid) });
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

  if (served.size === PERIODS.length) pass(`נטענו ${served.size} תקופות מהפיקסצ׳ר`);
  else fail(`נטענו ${served.size} תקופות מתוך ${PERIODS.length}`);

  const stamp = await page.textContent('#dataStamp');
  pass('חותמת: ' + stamp.replace(/\s+/g, ' ').trim());

  // ── 4. כל התצוגות מרנדרות ──────────────────────────────────────
  console.log('\n── תצוגות ──');
  const views = await page.$$eval('.sb-item[data-view]', els =>
    els.map(e => ({ id: e.dataset.view, label: e.innerText.replace(/\s+/g, ' ').trim() })));
  // מספר התצוגות נגזר מהדף ולא צרוב כאן — אחרת הבדיקה מתיישנת בכל תצוגה
  // חדשה. מה שכן נבדק: לכל section.view יש פריט סיידבר שמוביל אליו.
  const sections = await page.$$eval('section.view', els => els.length);
  if (views.length !== sections)
    fail(`${sections} section.view בדף אבל ${views.length} פריטי סיידבר — תצוגה בלי כניסה מהתפריט?`);
  else pass(`${views.length} תצוגות בסיידבר, ${sections} section.view`);

  for (const v of views) {
    const before = noise.length;
    await page.click(`.sb-item[data-view="${v.id}"]`);
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

  // ── 5. הצלבת מספרים מול חישוב עצמאי ────────────────────────────
  console.log('\n── מספרים (מול חישוב עצמאי מהפיקסצ׳ר) ──');
  await page.click('.sb-item[data-view="overview"]');
  await page.waitForTimeout(150);

  const num = s => { const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const got = await page.evaluate(() => {
    const t = id => (document.getElementById(id)?.textContent || '').trim();
    return { schools: t('metaSchools'), tech: t('metaTotal'),
             p10: t('kPct10'), p11: t('kPct11'), p12: t('k12Pct'), drop: t('kDrop') };
  });
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
