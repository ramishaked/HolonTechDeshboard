#!/usr/bin/env node
/* ── רענון BigPicture/data.json ישירות מאתר שקיפות בחינוך ─────────────
   האתר מחזיר 403 לכל בקשה מכתובת שאינה ישראלית (נבדק 22.10.2026: Chromium
   ו-Firefox אמיתיים, מ-GitHub Actions בשיקגו, על כל כתובת באתר, בלי כותרות
   של חומת אש לבוטים: חסימה לפי מדינה). לכן הסקריפט הזה חייב לרוץ על מחשב
   עם כתובת ישראלית. הדרך הקבועה: GitHub self-hosted runner על מחשב כזה
   (.github/workflows/refresh-data.yml). אפשר גם ידנית: node tools/refresh-data.mjs

   מה הוא עושה: פותח דפדפן אמיתי על האתר, ובתוך הדף (אותו origin, בלי CORS)
   מריץ את eduCollect, אותו קוד שבדף BigPicture. כלומר אין כאן פרסר שני
   שיכול לסטות. התוצאה מאומתת, מושווית לקובץ הקיים, ורק אז נכתבת.

   שימוש:
     node tools/refresh-data.mjs              שליפה וכתיבה של BigPicture/data.json
     --dry        בלי לכתוב, רק דוח השוואה
     --force      לכתוב גם כשהפערים מול הקובץ הקיים חריגים
     --headed     דפדפן גלוי (לאבחון)
     --out FILE   יעד אחר
     --mock       API מדומה במקום האתר (לבדיקות; tools/shkifut-mock.mjs)
     --from FILE  בלי דפדפן: מעבד קובץ גולמי (הפלט של eduCollect) שנאסף בדפדפן
                  ישראלי ועבר אל המחשב הזה. אותו ניקוי, אימות והשוואה.
─────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = path.join(ROOT, 'BigPicture', 'index.html');
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const OUT = argv.includes('--out') ? path.resolve(argv[argv.indexOf('--out') + 1]) : path.join(ROOT, 'BigPicture', 'data.json');
const HOME = 'https://shkifut.education.gov.il/home';
const FOCUS = 66001;                                   // חולון: נשלפת ראשונה, כדי לזהות בעיה מוקדם
const CORE = ['ACHUZ_ZAKAIM', 'ACHUZ_ZAKAIM_MITZTYEN', 'ACHUZ_ZAKAIM_BG_TECH_ANG5', 'ACHUZ_ANGLIT_5YL', 'ACHUZ_MATEM_5YL'];
const KEEP_VARS = new Set([...CORE, 'ACHUZ_ANGLIT_4YL', 'ACHUZ_MATEM_4YL', 'ACHUZ_ZAK_TECH_KLALI', 'ACHUZ_ZAK_TECH_33', 'ACHUZ_ZAK_TECH_21_31_32_33']);
const KEEP_K = /SOTSYO|SOCIO|ESHKOL|MACHOZ|^TALMIDIM(_12|_TECHNOLOGI)?$|MDD_SAL_ISHI|OCHLUS|UCHLUS/i;   // מה שהדף קורא מ-rashutKlali
const MAX_DIFF_SHARE = 0.2;                            // יותר מזה מהערכים הקיימים שהשתנו = כנראה שליפה שבורה

const die = (m, code = 1) => { console.error('\n✗ ' + m); process.exit(code); };
const log = m => console.log(m);

async function launch(chromium) {
  const tries = flag('--mock')
    ? [{ executablePath: '/opt/pw-browsers/chromium' }, {}]
    : [{ channel: 'chrome' }, { channel: 'msedge' }, {}];          // Chrome מותקן במחשב, ואם אין: ה-Chromium של Playwright
  let last;
  for (const t of tries) {
    try { return await chromium.launch({ headless: !flag('--headed'), ...t }); } catch (e) { last = e; }
  }
  die('לא עלה דפדפן. להריץ פעם אחת: cd tools && npx playwright-core install chromium\n' + String(last).split('\n')[0]);
}

const html = fs.readFileSync(PAGE, 'utf8');
const src = (html.match(/async function eduCollect\([^)]*\) \{[\s\S]*?\n\}\n/) || [])[0];
if (!src) die('לא נמצאה eduCollect ב-BigPicture/index.html');

let raw;
if (argv.includes('--from')) {
  raw = fs.readFileSync(path.resolve(argv[argv.indexOf('--from') + 1]), 'utf8');
  log('מעבד קובץ גולמי: ' + argv[argv.indexOf('--from') + 1]);
} else {
let chromium;
for (const pkg of [path.join(HERE, 'node_modules', 'playwright-core', 'index.mjs'), 'playwright-core', 'playwright']) {
  try { ({ chromium } = await import(pkg)); break; } catch { /* הבא */ }
}
if (!chromium) die('playwright-core לא מותקן: npm install --prefix tools');

const browser = await launch(chromium);
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem', viewport: { width: 1366, height: 800 } });
const page = await ctx.newPage();

if (flag('--mock')) {
  const { api } = await import('./shkifut-mock.mjs');
  await page.route('https://shkifut.education.gov.il/**', route => {
    const u = route.request().url();
    if (u.includes('/api/')) { const b = api(u); return route.fulfill({ status: b ? 200 : 404, contentType: 'application/json', body: JSON.stringify(b) }); }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title><body>mock</body>' });
  });
}

log('פותח את ' + HOME);
const resp = await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => die('הדף לא נטען: ' + String(e).split('\n')[0]));
if (resp.status() >= 400) {
  await browser.close();
  die(`האתר החזיר ${resp.status()}. אם זה 403: האתר חוסם כתובות שאינן ישראליות, והסקריפט רץ ממחשב שכזה.`, 3);
}
await page.waitForTimeout(flag('--mock') ? 0 : 3000);
await page.exposeFunction('__prog', m => process.stdout.write('\r  ' + String(m).padEnd(56)));

log('אוסף נתונים (כדקה עד שלוש)');
raw = await page.evaluate(async ({ src, focus }) => {
  const collect = new Function(src + '\nreturn eduCollect;')();
  return JSON.stringify(await collect('', m => window.__prog(m), null, focus));
}, { src, focus: FOCUS }).catch(e => die('האיסוף נכשל: ' + String(e).split('\n')[0]));
await browser.close();
process.stdout.write('\n');
}

/* ── ניקוי: רק מה שהדף קורא, כדי שהקובץ יישאר קטן והשינויים בגיט קריאים ── */
const data = JSON.parse(raw);
const slim = o => { const out = {}; for (const [c, vs] of Object.entries(o || {})) { out[c] = {}; for (const [v, arr] of Object.entries(vs)) if (KEEP_VARS.has(v)) out[c][v] = arr; } return out; };
data.national = slim(data.national);
data.rashuyot = data.rashuyot.filter(r => Object.values(r.h).some(c => Object.keys(c).length)).map(r => ({
  s: r.s, n: r.n, snif: r.snif, h: slim(r.h), k: Object.fromEntries(Object.entries(r.k || {}).filter(([k]) => KEEP_K.test(k.split('.').pop()))),
}));
data.note = `נשלף ישירות מ-${HOME} ב-${new Date().toISOString().slice(0, 10)} על ידי tools/refresh-data.mjs (הקוד של eduCollect שבדף).`;
const yi = y => data.years.indexOf(y);

/* ── אימות ──────────────────────────────────────────────────────── */
const bad = [];
if (data.rashuyot.length < (flag('--mock') ? 10 : 200)) bad.push(`רק ${data.rashuyot.length} רשויות עם נתוני בגרות`);
const holon = data.rashuyot.find(r => r.s === FOCUS);
if (!holon) bad.push('חולון חסרה');
for (const v of CORE) {
  const a = data.national?.['12']?.[v]?.[yi(data.year)];
  if (a == null) bad.push(`ארצי ${v} ${data.year} חסר`);
  if (holon && holon.h['12']?.[v]?.[yi(data.year)] == null) bad.push(`חולון ${v} ${data.year} חסר`);
}
let outOfRange = 0;
for (const r of data.rashuyot) for (const c of Object.values(r.h)) for (const arr of Object.values(c)) for (const x of arr) if (x != null && (x < 0 || x > 100)) outOfRange++;
if (outOfRange) bad.push(`${outOfRange} ערכים מחוץ ל-0..100`);
if (!data.rashuyot.some(r => Object.keys(r.k).some(k => /SOTSYO|ESHKOL/i.test(k)))) bad.push('לא נמצא שדה אשכול ב-rashutKlali (הדף יפול לטבלת הגיבוי)');
if (!data.rashuyot.some(r => Object.keys(r.k).some(k => /MACHOZ/i.test(k)))) bad.push('לא נמצא שדה מחוז ב-rashutKlali');
if (data.failed?.length > 5) bad.push(`${data.failed.length} רשויות לא נטענו: ${data.failed.slice(0, 5).join(', ')}`);
if (bad.length) die('האימות נכשל, הקובץ לא נכתב:\n  - ' + bad.join('\n  - '), 4);

/* ── השוואה לקובץ הקיים: חמשת המדדים, כלל י״ב, כל שנה ששני הקבצים מכילים ── */
let prev = null;
try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* אין קובץ קודם */ }
let checked = 0; const diffs = [];
if (prev) {
  const pm = new Map(prev.rashuyot.map(r => [r.s, r]));
  for (const r of data.rashuyot) {
    const o = pm.get(r.s); if (!o) continue;
    for (const v of CORE) for (const y of prev.years) {
      const a = o.h?.['12']?.[v]?.[prev.years.indexOf(y)], b = r.h['12']?.[v]?.[yi(y)];
      if (a == null || b == null) continue;
      checked++; if (Math.abs(a - b) > 0.05) diffs.push({ n: r.n, v, y, old: a, now: b });
    }
  }
}
log(`\n${data.rashuyot.length} רשויות · שנת נתונים ${data.year} · ${data.years[0]} עד ${data.years.at(-1)}`);
const h = holon.h['12'];
log('חולון ' + data.year + ': ' + CORE.map(v => h[v][yi(data.year)]).join(' · ') + '   ארצי: ' + CORE.map(v => data.national['12'][v][yi(data.year)]).join(' · '));
if (prev) {
  log(`מול הקובץ הקיים: נבדקו ${checked} ערכים, ${diffs.length} שונים`);
  diffs.slice(0, 12).forEach(d => log(`  ${d.n} ${v2(d.v)} ${d.y}: ${d.old} ← ${d.now}`.replace('←', 'הפך ל')));
  if (checked && diffs.length / checked > MAX_DIFF_SHARE && !flag('--force'))
    die(`${Math.round(diffs.length / checked * 100)}% מהערכים השתנו. זה לא נראה כמו רענון רגיל. הקובץ לא נכתב (--force לעקיפה).`, 5);
}
function v2(v) { return v.replace('ACHUZ_', '').replace('ZAKAIM_', ''); }

if (flag('--dry')) { log('\n--dry: לא נכתב'); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(data));
log(`\n✓ נכתב ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
