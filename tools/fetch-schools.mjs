#!/usr/bin/env node
/* ── מדדי הבגרות הרשמיים לפי בית ספר, מאתר שקיפות בחינוך ─────────────
   מפיק את הסדרות ש-SCHOOL_MOE שב-index.html מציג בגרף "התפתחות המדדים"
   (העמקה לבית ספר): חמישה מדדים, כלל י"ב, לכל השנים שבאתר.

   ⚠ האתר חוסם כתובות שאינן ישראליות (ראה tools/refresh-data.mjs), ולכן
   הסקריפט חייב לרוץ ממחשב בישראל. הוא פותח דפדפן אמיתי על האתר ושולף
   מתוכו (אותו origin).

   שימוש:  node tools/fetch-schools.mjs            מדפיס JSON ל-stdout
           node tools/fetch-schools.mjs --out F    כותב לקובץ
   אחרי השליפה: לעדכן ידנית את SCHOOL_MOE / SCHOOL_MOE_YEARS ב-index.html
   ואת "בתי_ספר_סדרות" ב-data/national.json. verify.mjs משווה ביניהם.

   המפתח הוא שם בית הספר כפי שהוא בגיליון. בית ספר בלי שכבת יב׳ אינו כאן. */
import fs from 'node:fs';
const SCHOOLS = { 'אורט':570168, 'אילון':540294, 'הייטק היי':540450, 'הרצוג':540864,
  'יבנה':540302, 'נבון':544528, 'עתידים':544593, 'קוגל':540310, 'קציר':544353,
  'קרית שרת':541110, 'הראל':544692 };
const VARS = { zak:'ACHUZ_ZAKAIM', mitz:'ACHUZ_ZAKAIM_MITZTYEN', tech:'ACHUZ_ZAKAIM_BG_TECH_ANG5',
  en5:'ACHUZ_ANGLIT_5YL', ma5:'ACHUZ_MATEM_5YL' };
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const { chromium } = await import('playwright-core');
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const page = await browser.newPage();
const home = await page.goto('https://shkifut.education.gov.il/home', { waitUntil: 'domcontentloaded' });
if (!home || home.status() !== 200) { console.error('האתר לא נפתח (HTTP ' + (home && home.status()) + '). כתובת לא ישראלית?'); process.exit(1); }
const get = u => page.evaluate(async u => { const r = await fetch(u, { headers: { Accept: 'application/json' } }); return r.ok ? r.json() : null; }, u);

const lists = await get('/api/data/lists');
const years = lists.years.map(y => y.SHANA_LOAZITH).sort((a, b) => a - b);
const last = years[years.length - 1];
const out = { years, schools: {} };
for (const [name, semel] of Object.entries(SCHOOLS)) {
  const m = await get(`/api/data/mosad/?semelMosad=${semel}&year=${last}`);
  if (!m) { console.error('אין נתון ל-' + name + ' (' + semel + ')'); process.exit(1); }
  const h = Object.fromEntries(m.mosadAkavishHistoryCompare.filter(r => r.Class_Id === 12).map(r => [r.year, r]));
  out.schools[name] = { semel, official: m.mosadGenaralData.SHEM_MOSAD,
    ...Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, years.map(y => (h[y] && h[y][v] != null) ? h[y][v] : null)])) };
}
await browser.close();
const json = JSON.stringify(out, null, 1);
const i = process.argv.indexOf('--out');
if (i > 0) fs.writeFileSync(process.argv[i + 1], json); else console.log(json);
