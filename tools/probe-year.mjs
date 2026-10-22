#!/usr/bin/env node
/* ── שליפת אבחון: שורות ההיסטוריה הגולמיות של מדדי הליבה, לכל הרשויות ─────────────────
   למה: באתר שקיפות בחינוך בעמוד חולון כתוב "זכאות לבגרות טק" 14.8, וב-data.json
   (שנשלף מ-rashutHistory) יש 14.6. נקודת הקצה של השנה (rashut?year=) אינה מכילה
   נתוני בגרות כלל (נבדק 22.10). החשד: ב-rashutHistory יש כמה שורות לאותו
   (מדד, כיתה, שנה) עם Entity_id שונה, ו-series() ב-eduCollect שומרת רק אחת.
   הסקריפט שומר את כל השורות הגולמיות של מדדי הליבה, לכל הרשויות.
   חייב לרוץ ממחשב ישראלי (האתר חוסם חו"ל), כמו refresh-data.mjs.

   שימוש:  node tools/probe-year.mjs [--headed] [--years 2025,2024]
   פלט:    BigPicture/probe-2025.json  (קובץ אבחון חד-פעמי, לא נקרא על ידי הדף)
──────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const years = (argv.includes('--years') ? argv[argv.indexOf('--years') + 1] : '2025,2024').split(',').map(Number);
const OUT = path.join(ROOT, 'BigPicture', 'probe-2025.json');
const HOME = 'https://shkifut.education.gov.il/home';
const die = m => { console.error('\n✗ ' + m); process.exit(1); };

let chromium;
for (const pkg of [path.join(HERE, 'node_modules', 'playwright-core', 'index.mjs'), 'playwright-core', 'playwright']) {
  try { ({ chromium } = await import(pkg)); break; } catch { /* הבא */ }
}
if (!chromium) die('playwright-core לא מותקן: npm install --prefix tools');
let browser, last;
for (const t of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
  try { browser = await chromium.launch({ headless: !flag('--headed'), ...t }); break; } catch (e) { last = e; }
}
if (!browser) die('לא עלה דפדפן: ' + String(last).split('\n')[0]);
const page = await (await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })).newPage();
const resp = await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => die('הדף לא נטען: ' + String(e).split('\n')[0]));
if (resp.status() >= 400) die(`האתר החזיר ${resp.status()} (חסימה לפי מדינה? צריך מחשב עם כתובת ישראלית)`);
await page.waitForTimeout(3000);
await page.exposeFunction('__prog', m => process.stdout.write('\r  ' + String(m).padEnd(50)));

const out = await page.evaluate(async ({ years }) => {
  const g = async u => { for (let t = 0; t < 3; t++) { try { const r = await fetch(u, { headers: { Accept: 'application/json' } }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch {} await new Promise(r => setTimeout(r, 400 * (t + 1))); } return null; };
  // כל אובייקט שיש לו Var_id, בכל עומק, עם הנתיב שבו נמצא וכל השדות שלו (Class_Id, Entity_id ועוד)
  const vars = (o, p = '', acc = []) => {
    if (Array.isArray(o)) o.forEach((x, i) => vars(x, p + '[' + i + ']', acc));
    else if (o && typeof o === 'object') { if ('Var_id' in o) acc.push({ path: p.replace(/\[\d+\]/g, '[]'), ...o }); else for (const [k, v] of Object.entries(o)) vars(v, p + '.' + k, acc); }
    return acc;
  };
  const CORE = new Set(['ACHUZ_ZAKAIM', 'ACHUZ_ZAKAIM_MITZTYEN', 'ACHUZ_ZAKAIM_BG_TECH_ANG5', 'ACHUZ_ANGLIT_5YL', 'ACHUZ_MATEM_5YL']);
  const lists = await g('/api/data/lists');
  const rash = Object.values(lists.infoLists).filter(x => +x.Mode === 2).map(x => ({ s: +x.Semel, n: String(x.Shem || '').trim() }));
  const res = { collectedAt: new Date().toISOString(), years, holonHistoryRaw: null, holonHistoryTopKeys: null, rashuyot: {} };
  // חולון: כל תשובת ההיסטוריה הגולמית (כל המפתחות, כל השורות)
  const hh = await g('/api/data/rashutHistory/?semelRashut=66001');
  res.holonHistoryTopKeys = hh && Object.keys(hh); res.holonHistoryRaw = hh;
  let i = 0, done = 0;
  const work = async () => { while (i < rash.length) { const r = rash[i++];
    const d = await g('/api/data/rashutHistory/?semelRashut=' + r.s);
    // כל השורות של מדדי הליבה, בכל Class_Id וכל Entity_id, לשנים שביקשנו. בלי איחוד ובלי "האחרונה מנצחת"
    res.rashuyot[r.s] = { n: r.n, rows: d ? vars(d).filter(x => CORE.has(x.Var_id) && years.includes(+x.year)) : null };
    window.__prog(++done + ' מתוך ' + rash.length); } };
  await Promise.all(Array.from({ length: 6 }, work));
  return res;
}, { years });
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\n✓ נכתב ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB), ${Object.keys(out.rashuyot).length} רשויות`);
