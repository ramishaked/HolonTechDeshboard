#!/usr/bin/env node
/* אבחון: אילו בקשות /api/ העמוד הרשמי שולח בלשונית "בגרות" (חולון מול רמת גן),
   ומאיפה בא "זכאות לבגרות טק" שמוצג בעמוד. אחר כך שולף את rashutEduPic לכל הרשויות.
   חייב לרוץ ממחשב ישראלי. שימוש: node tools/probe-page.mjs
   פלט: BigPicture/probe-page.json, BigPicture/probe-all.json.gz */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const ctx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
const TARGETS = ['66001', '86009'];
const MARK = /14\.[89]|16\.4/;
const out = { collectedAt: new Date().toISOString(), pages: {} };
let first;
for (const s of TARGETS) {
  const page = first = await ctx.newPage();
  const phase = { v: 'load' }, log = [], pending = [];
  page.on('response', r => {
    if (!r.url().includes('/api/')) return;
    const ph = phase.v;
    pending.push(r.text().catch(() => null).then(body => log.push({ phase: ph, url: r.url(), status: r.status(), body })));
  });
  await page.goto(`https://shkifut.education.gov.il/city/${s}/educationPicture`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(2000);
  phase.v = 'bagrut-tab';
  await page.locator('button[role="tab"][aria-label="בגרות"]').click();
  await page.waitForTimeout(4000);
  const techLine = () => page.evaluate(() => document.body.innerText.match(/זכאות לבגרות טק - [^\n]*/g));
  const withSpecial = await techLine();
  phase.v = 'toggle-off';
  await page.getByText('כולל חינוך מיוחד', { exact: true }).first().click();
  await page.waitForTimeout(4000);
  const withoutSpecial = await techLine();
  await Promise.all(pending);
  out.pages[s] = { techLine: { withSpecial, withoutSpecial }, log };
  if (s !== TARGETS.at(-1)) await page.close();
}
const keep = l => l.body && (MARK.test(l.body) || /ACHUZ_ZAKAIM/.test(l.body));
const pageOut = { collectedAt: out.collectedAt, pages: {} };
for (const s of TARGETS) pageOut.pages[s] = {
  techLine: out.pages[s].techLine,
  requests: out.pages[s].log.map(l => ({ phase: l.phase, status: l.status, url: l.url })),
  bodies: out.pages[s].log.filter(keep).map(l => ({ url: l.url, body: l.body })),
};
fs.writeFileSync(path.join(ROOT, 'BigPicture', 'probe-page.json'), JSON.stringify(pageOut));
console.log(JSON.stringify(Object.fromEntries(TARGETS.map(s => [s, out.pages[s].techLine]))));

// שלב 5: rashutEduPic לכל הרשויות שב-data.json (בגרות = group 5, זכאות טכנולוגית = group 7)
const symbols = JSON.parse(fs.readFileSync(path.join(ROOT, 'BigPicture', 'data.json'), 'utf8')).rashuyot.map(r => r.s);
const all = await first.evaluate(async ({ symbols }) => {
  const g = async u => { for (let t = 0; t < 3; t++) { try { const r = await fetch(u, { headers: { Accept: 'application/json' } }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch {} await new Promise(r => setTimeout(r, 400 * (t + 1))); } return null; };
  const res = {}; let i = 0;
  const work = async () => { while (i < symbols.length) { const s = symbols[i++];
    const d = await g('/api/data/rashutEduPic/?semelRashut=' + s + '&year=2025');
    res[s] = d && d.groups.filter(x => x.Id === 5 || x.Id === 7).map(x => ({ Id: x.Id, Name: x.Name, Classes: x.Classes.map(c => ({ Id: c.Id, Indexes: c.Indexes.map(n => ({ Id: n.Id, Name: n.Name, Year: n.Year, Value: n.Value, Talmidim: n.Talmidim, Zakaim: n.Zakaim, History: (n.History || []).map(h => [h.Year, h.IndexValue, (h.CompareValuesModel || []).map(v => v.Value)]) })) })) })); } };
  await Promise.all(Array.from({ length: 6 }, work));
  return res;
}, { symbols });
fs.writeFileSync(path.join(ROOT, 'BigPicture', 'probe-all.json.gz'), zlib.gzipSync(JSON.stringify({ collectedAt: out.collectedAt, source: 'rashutEduPic?year=2025, groups 5 and 7', rashuyot: all })));
console.log('rashuyot', symbols.length, 'null:', Object.values(all).filter(v => !v).length);
await browser.close();
