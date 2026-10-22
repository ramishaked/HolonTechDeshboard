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

import { api } from './shkifut-mock.mjs';

/* ── הרצת קוד האיסוף ב-Node, עם DOM מינימלי ─────────────────────── */
async function runCollector() {
  const core = html.match(/async function eduCollect\([^)]*\) \{[\s\S]*?\n\}\n/), ui = html.match(/async function shkifutCollector\(\) \{[\s\S]*?\n\}\n/);
  if (!core || !ui) { fail('לא נמצאו eduCollect / shkifutCollector בדף'); return null; }
  const m = [core[0] + ui[0]];
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
  await fn(...Object.values(env));
  if (!downloaded) { fail('האיסוף לא הוריד קובץ'); return null; }
  const data = JSON.parse(await downloaded.text());
  pass(`האיסוף: ${data.rashuyot.length} רשויות, שנה ${data.year}, כשלים ${data.failed.length}`);
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

async function openPage(browser, data, viewport = { width: 1280, height: 900 }, live = null, query = '') {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith('http://bp.local/BigPicture/data.json')) return data ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }) : route.fulfill({ status: 404, body: '' });
    if (u.startsWith('http://bp.local/BigPicture/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.startsWith('https://shkifut.education.gov.il/api/') && live === 'ok') {
      const b = api(u); await new Promise(r => setTimeout(r, 15));
      return route.fulfill({ status: b ? 200 : 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    }
    return route.abort();
  });
  await page.goto('http://bp.local/BigPicture/' + query);
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
  bars === 10 && me === 1 ? pass('ברירת מחדל: בחירה ידנית, 10 ערים, חולון מסומנת') : fail(`ברירת מחדל: מוטות ${bars}, מסומנת ${me}`);
  const names = (await page.locator('.bar .nm .t').allInnerTexts()).map(x => x.trim());
  const want = ['חולון', 'בת ים', 'ראשון לציון', 'פתח תקווה', 'תל אביב', 'רמת גן', 'נתניה', 'אשדוד', 'רחובות', 'הרצליה'];
  want.every(w => names.some(n => n.startsWith(w))) ? pass('ברירת המחדל כוללת את כל הערים שנקבעו, ועוד רחובות והרצליה') : fail('ערים חסרות: ' + want.filter(w => !names.some(n => n.startsWith(w))).join(', '));
  (await page.locator('.pill[data-g="custom"][aria-pressed="true"]').count()) === 1 ? pass('"בחירה ידנית" היא הקבוצה הנבחרת') : fail('הקבוצה הנבחרת אינה בחירה ידנית');
  (await page.locator('svg.trend, .card h2:has-text("לאורך השנים")').count()) === 0 ? pass('גרף "לאורך השנים" הוסר') : fail('גרף המגמה עדיין מוצג');
  await page.click('.pill[data-g="cluster"]');
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

  // data.json האמיתי שבריפו: נטען ישר, בלי כלום מהרשת
  const realPath = path.resolve(HERE, '..', 'BigPicture', 'data.json');
  if (fs.existsSync(realPath)) {
    const real = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    const rp = await openPage(browser, real);
    const v0 = await rp.page.locator('.kpi .v').first().innerText().catch(() => '');
    const v2 = await rp.page.locator('.kpi .v').nth(2).innerText().catch(() => '');
    v0.includes('82.1') && v2.includes('14.6') ? pass('data.json האמיתי: חולון זכאות 82.1%, בגרות טק 14.6%') : fail(`data.json האמיתי: "${v0}" "${v2}"`);
    const hn = await rp.page.locator('#heroNote').innerText();
    hn.includes('22.10.2026') ? pass('data.json האמיתי: תאריך האיסוף מוצג') : fail('תאריך האיסוף חסר: ' + hn);
    for (const g of ['cluster', 'size', 'region']) {
      await rp.page.click(`.pill[data-g="${g}"]`);
      const n = await rp.page.locator('.bar').count(), hh = await rp.page.locator('section.card h2').first().innerText();
      n >= 5 ? pass(`data.json האמיתי, קבוצה ${g}: ${n} רשויות · ${hh.split('·').pop().trim()}`) : fail(`data.json האמיתי, קבוצה ${g}: ${n} רשויות`);
    }
    await rp.page.click('.pill[data-g="cluster"]');
    (await rp.page.locator('.mini .v').first().innerText()).includes('מתוך') ? pass('data.json האמיתי: דירוג חולון באשכול 7 מוצג') : fail('דירוג חסר');
    // שיעור שינוי יחסי באריחי הליבה: זכאות חולון 82.1 מול 83.8 (שנה קודמת) ומול 77.9 (ארצי)
    const chips = await rp.page.locator('.kpi').first().locator('.chip').allInnerTexts();
    chips[0]?.includes('-1.7') && chips[0].includes('(-2.0%)') ? pass(`אריח הזכאות מול שנה שעברה: ${chips[0].replace(/\s+/g, ' ')}`) : fail('שינוי יחסי מול שנה שעברה: ' + chips[0]);
    chips[1]?.includes('+4.2') && chips[1].includes('(+5.4%)') ? pass(`אריח הזכאות מול הארצי: ${chips[1].replace(/\s+/g, ' ')}`) : fail('שינוי יחסי מול הארצי: ' + chips[1]);
    const allRel = (await rp.page.locator('.kpi .chip').allInnerTexts()).every(x => /%\)/.test(x));
    allRel ? pass('בכל חמשת האריחים מוצג שיעור שינוי יחסי, מול שנה שעברה ומול הארצי') : fail('חסר שיעור שינוי יחסי באריח');
    // טבלה: חיווי מיון
    (await rp.page.locator('th[aria-sort="descending"]').count()) === 1 && (await rp.page.locator('td.sorted').count()) > 5 ? pass('הטבלה: עמודת המיון מסומנת (כותרת, חץ ותאים)') : fail('חיווי המיון חסר');
    (await rp.page.locator('.card .lede', { hasText: 'ממוין לפי' }).first().innerText()).includes('מהגבוה לנמוך') ? pass('הטבלה: משפט "ממוין לפי ... מהגבוה לנמוך"') : fail('משפט המיון חסר');
    (await rp.page.locator('.mlist').first().isVisible()) === false && (await rp.page.locator('.tbl-core').first().isVisible()) ? pass('דסקטופ: טבלה מוצגת, רשימת המובייל מוסתרת') : fail('דסקטופ: תצוגה שגויה');
    await rp.page.click('th button[data-sort="ACHUZ_MATEM_5YL"]');
    (await rp.page.locator('th.sorted').innerText()).includes('מתמטיקה') ? pass('לחיצה על כותרת ממיינת ומעבירה את הסימון') : fail('המיון לא עבר');
    await rp.page.click('th button[data-sort="ACHUZ_MATEM_5YL"]');
    (await rp.page.locator('th[aria-sort="ascending"]').count()) === 1 ? pass('לחיצה נוספת הופכת את כיוון המיון') : fail('הכיוון לא התהפך');
    const cellYoy = await rp.page.locator('tr.me td').nth(1).locator('small').innerText();
    cellYoy.includes('-1.7') && cellYoy.includes('(-2.0%)') ? pass(`הטבלה, שינוי מול שנה שעברה: ${cellYoy}`) : fail('תא בטבלה: ' + cellYoy);
    await rp.page.click('[data-tb="nat"]');
    const cellNat = await rp.page.locator('tr.me td').nth(1).locator('small').innerText();
    cellNat.includes('+4.2') && cellNat.includes('(+5.4%)') ? pass(`הטבלה, שינוי מול הארצי: ${cellNat}`) : fail('תא בטבלה מול ארצי: ' + cellNat);
    {
      const snap = async () => (await rp.page.locator('tbody tr.me td small').allInnerTexts()).join('|');
      const nat = await snap(); await rp.page.click('[data-tb="yoy"]'); const yoy = await snap();
      const ups = (await rp.page.locator('tbody tr:not(.nat) td small').allInnerTexts()).length;
      nat !== yoy && ups > 20 ? pass('הטבלה: החלפת "שינוי מול" משנה את מספרי השינוי בכל השורות, לא רק צבעים') : fail('מספרי השינוי לא השתנו עם הבורר');
      (await rp.page.locator('.ctl .na', { hasText: 'מתחת לכל ערך' }).first().innerText()).includes('תשפ״ד') ? pass('הכיתוב מעל הטבלה מציין מול מה השינוי') : fail('כיתוב הבסיס חסר');
    }
    await rp.page.click('[data-tb="yoy"]');
    const d120 = await rp.page.locator('[data-pop="120"]').isDisabled();
    !d120 ? pass('חולון: מתג "ללא חינוך מיוחד" פעיל') : fail('המתג מנוטרל לחולון');
    // כל הרשויות מכילות עכשיו גם "ללא חנ״מ", היסטוריה ומדדים נוספים (לא רק חולון)
    const rish = real.rashuyot.find(r => r.n.startsWith('ראשון'));
    await rp.page.selectOption('#citySel', String(rish.s));
    if (rish.h['120']) {
      (await rp.page.locator('[data-pop="120"]').isDisabled()) ? fail('ראשון לציון יש לה נתוני חנ״מ אבל המתג מנוטרל') : pass('ראשון לציון: מתג "ללא חינוך מיוחד" פעיל (יש נתון)');
      await rp.page.click('[data-pop="120"]');
      const v120 = await rp.page.locator('.kpi .v').first().innerText();
      /\d/.test(v120) ? pass(`ראשון לציון ללא חנ״מ: ${v120.trim()}`) : fail('ראשון לציון ללא חנ״מ: אין ערך');
      await rp.page.click('[data-pop="12"]');
    }
    (await rp.page.locator('.card h2', { hasText: 'מדדים נוספים' }).count()) === 1 ? pass('ראשון לציון: כרטיס "מדדים נוספים" מוצג') : fail('מדדים נוספים חסר לראשון לציון');
    const no120 = real.rashuyot.find(r => !r.h['120'] && Object.keys(r.h).length);
    if (no120) {
      await rp.page.selectOption('#citySel', String(no120.s));
      (await rp.page.locator('[data-pop="120"]').isDisabled()) ? pass(`${no120.n}: אין נתוני חנ״מ, המתג מנוטרל`) : fail(`${no120.n}: המתג פעיל בלי נתון`);
    }
    (await rp.page.locator('.kpi .v').first().innerText()).length ? pass('הדף מציג רשות עם נתונים חלקיים בלי לקרוס') : fail('תצוגה ריקה');
    rp.errors.forEach(e => fail('data.json האמיתי, שגיאה: ' + e));
    await rp.page.close();
  } else fail('BigPicture/data.json חסר');

  // קישורים לרשות: ?city=סמל או שם, ברירת מחדל סבירה לרשות שאינה חולון, וחזרה לחולון כשהרשות לא נמצאה
  if (fs.existsSync(realPath)) {
    const real2 = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    const cases = [
      ['?city=62000', 'בת ים', 'cluster', 'לפי סמל'],
      ['?city=' + encodeURIComponent('בת ים'), 'בת ים', 'cluster', 'לפי שם'],
      ['#city=84004', 'רחובות', 'cluster', 'קישור ישן עם #'],
      ['?city=62000&g=custom', 'בת ים', 'custom', 'קבוצה מפורשת גוברת'],
      ['?city=' + encodeURIComponent('ראשון'), 'ראשון לציון', 'cluster', 'שם חלקי'],
    ];
    for (const [q, name, g, what] of cases) {
      const lp = await openPage(browser, real2, { width: 1280, height: 900 }, null, q);
      const title = await lp.page.locator('#title').innerText();
      const pressed = await lp.page.locator('.pill[data-g][aria-pressed="true"]').first().getAttribute('data-g');
      title.includes(name) && pressed === g ? pass(`קישור ${what}: נפתח על ${name}, קבוצה ${g}`) : fail(`קישור ${what} (${q}): כותרת "${title}", קבוצה ${pressed}`);
      lp.errors.forEach(e => fail('קישור, שגיאה: ' + e));
      await lp.page.close();
    }
    const bad = await openPage(browser, real2, { width: 1280, height: 900 }, null, '?city=999');
    const bt = await bad.page.locator('#title').innerText(), bn = await bad.page.locator('#heroNote').innerText();
    bt.includes('חולון') && bn.includes('לא נמצאה') ? pass('רשות לא קיימת: מוצגת חולון עם הודעה') : fail(`רשות לא קיימת: "${bt}" / "${bn}"`);
    await bad.page.close();
    const hp = await openPage(browser, real2, { width: 1280, height: 900 }, null, '');
    const hg = await hp.page.locator('.pill[data-g][aria-pressed="true"]').first().getAttribute('data-g');
    hg === 'custom' && (await hp.page.locator('#title').innerText()).includes('חולון') ? pass('בלי פרמטר: חולון, בחירה ידנית') : fail('ברירת המחדל השתנתה');
    await hp.page.selectOption('#citySel', '62000');
    const u = hp.page.url();
    /\?city=62000/.test(u) && !u.includes('#') ? pass(`הכתובת מתעדכנת לשיתוף: ${u.replace('http://bp.local', '')}`) : fail('הכתובת לא עודכנה: ' + u);
    (await hp.page.locator('#copyLink').getAttribute('data-url')) === 'http://bp.local/BigPicture/?city=62000' ? pass('כפתור "העתקת קישור לרשות": קישור נקי לרשות הנוכחית') : fail('data-url שגוי: ' + await hp.page.locator('#copyLink').getAttribute('data-url'));
    await hp.page.close();
  }

  // סקריפט הרענון (tools/refresh-data.mjs) מול ה-API המדומה: הקובץ שהוא כותב נטען בדף
  {
    const { execFileSync } = await import('node:child_process');
    const tmp = path.join(os.tmpdir(), 'bp-refresh-test.json');
    try { fs.rmSync(tmp, { force: true }); execFileSync('node', [path.join(HERE, 'refresh-data.mjs'), '--mock', '--out', tmp], { stdio: 'pipe', timeout: 120000 }); } catch (e) { fail('refresh-data --mock נכשל: ' + String(e.stderr || e.message).slice(0, 200)); }
    if (fs.existsSync(tmp)) {
      const out = JSON.parse(fs.readFileSync(tmp, 'utf8'));
      const rp2 = await openPage(browser, out);
      const k = await rp2.page.locator('.kpi .v').first().innerText().catch(() => '');
      k.includes('82.1') ? pass('refresh-data: הקובץ שהסקריפט כותב נטען בדף (חולון 82.1%)') : fail('refresh-data: הדף לא הציג את הקובץ: ' + k);
      rp2.errors.forEach(e => fail('refresh-data, שגיאה בדף: ' + e));
      await rp2.page.close(); fs.rmSync(tmp, { force: true });
    }
  }

  for (const w of [320, 360, 390, 768]) {
    const mob = await openPage(browser, data, { width: w, height: 844 });
    const check = async tag => {
      const r = await mob.page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        tables: [...document.querySelectorAll('.tbl-wrap')].map(e => e.scrollWidth - e.clientWidth).filter(x => x > 1).length,
        clipped: [...document.querySelectorAll('.kpi, .card, .mini')].filter(e => e.scrollWidth - e.clientWidth > 1).length,
      }));
      r.page <= 0 && !r.clipped ? pass(`${w}px ${tag}: אין גלילה אופקית ואין תוכן חתוך`) : fail(`${w}px ${tag}: דף ${r.page}px, רכיבים חתוכים ${r.clipped}`);
      if (w < 600) r.tables === 0 ? pass(`${w}px ${tag}: אין טבלה שגוללת הצידה`) : fail(`${w}px ${tag}: ${r.tables} טבלאות גוללות`);
    };
    await mob.page.click('.pill[data-g="cluster"]'); await check('אשכול');
    await mob.page.click('.pill[data-g="custom"]'); await check('בחירה ידנית');
    if (w < 600) { await mob.page.click('.sortbar .pill[data-sort="ACHUZ_ANGLIT_5YL"]');
      (await mob.page.locator('.sortbar .pill[aria-pressed="true"]').innerText()).includes('אנגלית') ? pass(`${w}px: מיון מכפתורי המובייל`) : fail(`${w}px: מיון במובייל לא עבד`); }
    if (w < 600) {
      const vis = await mob.page.evaluate(() => ({ list: getComputedStyle(document.querySelector('.mlist')).display, tbl: getComputedStyle(document.querySelector('.tbl-core')).display }));
      vis.list !== 'none' && vis.tbl === 'none' ? pass(`${w}px: רשימת דירוג במקום טבלה`) : fail(`${w}px: רשימה ${vis.list}, טבלה ${vis.tbl}`);
      const rowsN = await mob.page.locator('.mrow-h[data-open]').count();
      rowsN >= 5 ? pass(`${w}px: ${rowsN} שורות בדירוג`) : fail(`${w}px: ${rowsN} שורות`);
      const big = await mob.page.locator('.mrow .mv').first().innerText(), sortedFirst = await mob.page.locator('.mrow-h[data-open]').first().innerText();
      big.includes('%') && /\d/.test(sortedFirst) ? pass(`${w}px: בכל שורה המדד הממוין בגדול (${big.trim()})`) : fail(`${w}px: ערך גדול חסר`);
      const first = mob.page.locator('.mrow-h[data-open]').first();
      await first.click();
      const cols = await mob.page.locator('.mdet:not([hidden]) .mdr').count();
      cols === 5 && (await first.getAttribute('aria-expanded')) === 'true' ? pass(`${w}px: הקשה על רשות פותחת פירוט של 5 מדדים`) : fail(`${w}px: פירוט ${cols}`);
      await first.click();
      (await mob.page.locator('.mdet:not([hidden])').count()) === 0 ? pass(`${w}px: הקשה נוספת סוגרת`) : fail(`${w}px: הפירוט לא נסגר`);
      {
        const snapM = async () => (await mob.page.locator('.mrow.me, .mrow:not(.nat)').first().innerText()).replace(/\s+/g, ' ');
        const a1 = await snapM(); await mob.page.locator('[data-tb="nat"]').click(); const a2 = await snapM(); await mob.page.locator('[data-tb="yoy"]').click();
        const nums = s => (s.match(/[+-]?\d+\.\d/g) || []).join(' ');
        nums(a1) !== nums(a2) && /[+-]\d/.test(a2) ? pass(`${w}px: במובייל המספרים (לא רק הצבעים) משתנים עם "שינוי מול"`) : fail(`${w}px: מובייל, המספרים לא השתנו: ${nums(a1)} | ${nums(a2)}`);
        (await mob.page.locator('.mrow:not(.nat) .mc .dd').count()) >= 4 ? pass(`${w}px: בכל שורה מוצג שינוי גם למדדים הקטנים`) : fail(`${w}px: חסר שינוי במדדים הקטנים`);
      }
      await first.click();                                           // פתוח בזמן הצילום
    }
    if (SHOT && w === 390) { await mob.page.click('.pill[data-g="cluster"]'); await mob.page.screenshot({ path: path.join(process.env.SHOT_DIR || os.tmpdir(), 'bp-mobile.png'), fullPage: true }); }
    mob.errors.forEach(e => fail(`${w}px, שגיאה: ` + e));
    await mob.page.close();
  }

  const emp = await openPage(browser, null);
  await emp.page.waitForSelector('.empty h2', { timeout: 15000 }).catch(() => {});
  (await emp.page.locator('.empty').count()) === 1 && await emp.page.locator('#upd').evaluate(d => d.open)
    ? pass('בלי data.json ובלי גישה לאתר: מסך הסבר עם הוראות עדכון') : fail('מסך ההסבר לא הוצג');
  emp.errors.forEach(e => fail('ריק, שגיאה: ' + e));
  await emp.page.close();

  // בלי data.json, והאתר של משרד החינוך נגיש מהדפדפן: הדף נפתח לבד עם נתונים
  const lv = await openPage(browser, null, { width: 1280, height: 900 }, 'ok');
  await lv.page.waitForSelector('.kpi .v', { timeout: 15000 }).catch(() => {});
  const first = await lv.page.locator('.kpi .v').first().innerText().catch(() => '');
  first.includes('82.1') ? pass('בלי data.json: הדף טען לבד מהאתר, חולון 82.1%') : fail(`טעינה חיה: "${first}"`);
  await lv.page.waitForFunction(() => !/נטענות רשויות/.test(document.querySelector('#heroNote').textContent), null, { timeout: 20000 }).catch(() => {});
  const nb = await lv.page.locator('.bar').count();
  nb >= 2 ? pass(`טעינה חיה: ההשוואה התמלאה (${nb} רשויות בקבוצה)`) : fail('טעינה חיה: ההשוואה ריקה');
  (await lv.page.locator('#heroNote').innerText()).includes('נטען כעת ישירות') ? pass('הכותרת מציינת שהנתונים נטענו כעת מהאתר') : fail('הכותרת לא מציינת טעינה חיה');
  lv.errors.forEach(e => fail('טעינה חיה, שגיאה: ' + e));
  await lv.page.close();

  // האתר חוסם את הדפדפן (CORS): מסך שגיאה מסביר, בלי קריסה
  const bl = await openPage(browser, null);
  await bl.page.waitForSelector('.empty h2', { timeout: 15000 }).catch(() => {});
  (await bl.page.locator('.empty h2').innerText().catch(() => '')).includes('לא נטענו')
    ? pass('כשהאתר חסום ואין data.json: מסך הסבר') : fail('מסך השגיאה לא הוצג');
  bl.errors.filter(e => !/Failed to fetch|CORS|net::/.test(e)).forEach(e => fail('חסום, שגיאה: ' + e));
  await bl.page.close();
  await browser.close();
}
if (SHOT) console.log('  צילומים: ' + path.join(process.env.SHOT_DIR || os.tmpdir(), 'bp-*.png'));
console.log(problems.length ? `\n${problems.length} בעיות` : '\nהכל תקין');
process.exit(problems.length ? 1 : 0);
