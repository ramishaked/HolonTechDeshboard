#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// בדיקה עצמית לבודק המהימנות.
//
// בונה גיליון סינתטי תקין לחלוטין ומוודא שהבודק מכריז "מהימן".
// ואז מזריק פגם אחד בכל פעם ומוודא שהבודק תופס בדיוק אותו.
//
// בלי זה אין לדעת אם "אין ממצאים" פירושו שהנתונים נקיים
// או שהגלאים פשוט לא יורים.
//
//   node tools/audit/selftest.mjs
// ════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const AUDIT = path.join(HERE, 'audit.mjs');

const ALL_GRADES = ['ז','ח','ט','י','יא','יב'];
const ROWS = ['כמות תלמידים','פיזיקה 5 יח׳','מדעי המחשב 5 יח׳','מתמטיקה 3יח׳',
              'מתמטיקה 4 יח׳','מתמטיקה 5 יח׳','אנגלית 5 יח׳','עתיד טק','זכאות למדד טק'];

const rng = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

// ── בניית גיליון סינתטי תקין ─────────────────────────────────────
// אותה גיאומטריה של הגיליון האמיתי: 6 בלוקים של 6 עמודות,
// כמות תלמידים בלי פילוח מגדרי, שורת מצבת, שורות סה״כ עיר.
function buildSheet(seed, { periodShift = 0, eligibilityBelow = false } = {}){
  const r = rng(seed);
  const pick = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

  const schools = [];
  for (let i = 0; i < 14; i++){
    const name = 'בי״ס ' + String.fromCharCode(1488 + i);
    // שלושה בתי ספר חלקיים, כמו בגיליון האמיתי (§3.5)
    const grades = i === 3 ? ['ז','ח','ט']
                 : i === 7 ? ['י']
                 : i === 11 ? ['י','יא','יב']
                 : ALL_GRADES;
    const data = {};
    for (const g of grades){
      const total = pick(70, 290) + periodShift;
      const cell = {};
      cell['כמות תלמידים'] = { boys:null, girls:null, total };

      const mk = cap => {
        const t = pick(0, Math.max(0, Math.floor(total * cap)));
        const b = Math.min(t, Math.floor(t * (0.3 + r() * 0.4)));
        return { boys:b, girls:t - b, total:t };
      };
      const ph = mk(0.25), cs = mk(0.25);
      // זכאות = איחוד: max ≤ ht ≤ ph+cs
      const lo = Math.max(ph.total, cs.total), hi = Math.min(total, ph.total + cs.total);
      // eligibilityBelow משחזר את הדפוס האמיתי של «הראל»: הזכאות היא
      // קריטריון צר יותר מלימוד המקצוע, ולכן קטנה מפיזיקה/מדמ״ח.
      const htT = eligibilityBelow ? Math.floor(lo * 0.6)
                                   : lo + Math.floor(r() * Math.max(0, hi - lo + 1));
      const htB = Math.min(htT, Math.floor(htT * (0.4 + r() * 0.3)));
      cell['פיזיקה 5 יח׳'] = ph;
      cell['מדעי המחשב 5 יח׳'] = cs;
      cell['זכאות למדד טק'] = { boys:htB, girls:htT - htB, total:htT };
      for (const s of ['מתמטיקה 3יח׳','מתמטיקה 4 יח׳','מתמטיקה 5 יח׳','אנגלית 5 יח׳']) cell[s] = mk(0.4);
      cell['עתיד טק'] = g === 'ט' ? mk(0.5) : { boys:0, girls:0, total:0 };
      data[g] = cell;
    }
    schools.push({ name, grades, data });
  }

  // ── הרכבת השורות ──
  const out = [];
  const wide = 2 + ALL_GRADES.length * 6;
  const blank = () => Array(wide).fill('');

  const h1 = blank(); h1[0] = 'בית ספר'; h1[1] = 'מקצועות';
  ALL_GRADES.forEach((g, i) => { h1[2 + i * 6] = 'שכבת ' + g; });
  out.push(h1);
  const h2 = blank();
  ALL_GRADES.forEach((_, i) => {
    const b = 2 + i * 6;
    h2[b] = 'בנים'; h2[b + 1] = 'בנות'; h2[b + 2] = 'סה"כ';
    h2[b + 3] = '% בנים'; h2[b + 4] = '% בנות'; h2[b + 5] = 'סה"כ';
  });
  out.push(h2);

  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '';
  for (const s of schools){
    for (const rowName of ROWS){
      const line = blank();
      line[0] = s.name; line[1] = rowName;
      ALL_GRADES.forEach((g, i) => {
        const c = s.data[g]?.[rowName];
        if (!c) return;
        const denom = s.data[g]['כמות תלמידים'].total;
        const b = 2 + i * 6;
        line[b]     = c.boys == null ? '' : String(c.boys);
        line[b + 1] = c.girls == null ? '' : String(c.girls);
        line[b + 2] = String(c.total);
        line[b + 3] = c.boys == null ? '' : pct(c.boys, denom);
        line[b + 4] = c.girls == null ? '' : pct(c.girls, denom);
        line[b + 5] = rowName === 'כמות תלמידים' ? '100%' : pct(c.total, denom);
      });
      out.push(line);
    }
  }

  out.push(blank());
  const mz = blank();
  // פסיק ומרכאות בתוך שדה — בדיוק כמו התווית האמיתית בגיליון
  mz[0] = 'מצבת'; mz[1] = 'כלל תלמידי העיר ע"פ מצבת המשרד, כולל חנ"מ';
  ALL_GRADES.forEach((g, i) => {
    const sum = schools.reduce((a, s) => a + (s.data[g]?.['כמות תלמידים'].total || 0), 0);
    mz[2 + i * 6 + 2] = String(sum + 40 + i);            // המצבת תמיד ≥ סכום בתי הספר
  });
  out.push(mz);
  out.push(blank());

  for (const rowName of ROWS){
    const line = blank();
    line[0] = 'סה"כ עיר'; line[1] = rowName;
    ALL_GRADES.forEach((g, i) => {
      let b = 0, gi = 0, t = 0;
      for (const s of schools){
        const c = s.data[g]?.[rowName];
        if (!c) continue;
        b += c.boys || 0; gi += c.girls || 0; t += c.total;
      }
      const base = 2 + i * 6;
      line[base] = String(b); line[base + 1] = String(gi); line[base + 2] = String(t);
    });
    out.push(line);
  }
  return out;
}

const esc = v => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const toCsv = rows => rows.map(r => r.map(esc).join(',')).join('\r\n');

// ── תשתית ההרצה ──────────────────────────────────────────────────
function gidsFromDashboard(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const block = html.match(/const\s+GID_MAP\s*=\s*\{([\s\S]*?)\}\s*;/)[1];
  return [...block.matchAll(/'([^']+)'\s*:\s*'(\d+)'/g)].map(m => ({ name:m[1], gid:m[2] }));
}

function writeSet(dir, sets){
  fs.mkdirSync(dir, { recursive: true });
  for (const [gid, rows] of Object.entries(sets)) fs.writeFileSync(path.join(dir, gid + '.csv'), toCsv(rows));
}

function runAudit(dir, extra = []){
  let out;
  try {
    out = execFileSync(process.execPath, [AUDIT, '--from-dir', dir, '--json', '--no-baseline', '--sample', '0', ...extra],
                       { encoding:'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e){
    out = e.stdout || '';
    if (!out.trim()) { console.error(e.stderr); throw new Error('audit.mjs קרס'); }
  }
  return JSON.parse(out);
}

// ── הפגמים ───────────────────────────────────────────────────────
// כל פגם: פונקציה שמשנה את הגיליון, וקוד הממצא שאמור להיתפס.
const FAULTS = [
  { code:'gender_sum', what:'בנים+בנות ≠ סה״כ',
    hit:(s, gid) => { const r = find(s[gid], 'זכאות למדד טק'); r[2] = String(+r[2] + 7); } },

  { code:'exceeds_total', what:'לומדי מקצוע > תלמידים בשכבה',
    hit:(s, gid) => { const r = find(s[gid], 'מדעי המחשב 5 יח׳'); const t = find(s[gid], 'כמות תלמידים');
                      r[4] = String(+t[4] + 25); r[2] = String(+t[4] + 25); r[3] = '0'; } },

  { code:'oracle_mismatch', what:'שורת «סה״כ עיר» לא מסכימה עם סכום בתי הספר',
    hit:(s, gid) => { const r = s[gid].find(x => x[0] === 'סה"כ עיר' && x[1] === 'כמות תלמידים'); r[22] = String(+r[22] + 11); } },

  { code:'row_vocabulary', what:'שם שורה שהשתנה בגיליון',
    hit:(s, gid) => { const r = find(s[gid], 'עתיד טק'); r[1] = 'עתיד הייטק'; } },

  { code:'duplicate_row', what:'אותה שורה פעמיים לאותו בית ספר',
    hit:(s, gid) => { const r = find(s[gid], 'פיזיקה 5 יח׳'); s[gid].splice(s[gid].indexOf(r) + 1, 0, r.slice()); } },

  { code:'negative', what:'ערך שלילי',
    hit:(s, gid) => { const r = find(s[gid], 'מתמטיקה 5 יח׳'); r[2] = '-4'; r[3] = '0'; r[4] = '-4'; } },

  { code:'non_numeric', what:'טקסט בתא מספרי',
    hit:(s, gid) => { const r = find(s[gid], 'אנגלית 5 יח׳'); r[4] = 'אין נתון'; } },

  { code:'orphan_values', what:'שכבה בלי «כמות תלמידים» אך עם נתונים',
    hit:(s, gid) => { const t = find(s[gid], 'כמות תלמידים'); t[4] = ''; t[7] = ''; } },

  { code:'matzevet_below', what:'מצבת קטנה מסכום בתי הספר',
    hit:(s, gid) => { const r = s[gid].find(x => x[0] === 'מצבת'); r[22] = '10'; } },

  { code:'field_emptied', what:'שורה שהתרוקנה בין תקופות',
    hit:(s, gid, all) => { const last = all[all.length - 1].gid;
      for (const r of s[last]) if (r[1] === 'עתיד טק') for (let i = 2; i < r.length; i++) if (r[i] !== '') r[i] = '0'; } },

  { code:'sharp_jump', what:'קפיצה חדה בין שתי דגימות',
    hit:(s, gid, all) => { const last = all[all.length - 1].gid;
      const r = find(s[last], 'זכאות למדד טק'); r[20] = '0'; r[21] = '0'; r[22] = '0'; } },
];

// שורת הנתונים הראשונה של בית הספר הראשון עבור שם שורה נתון
const find = (rows, rowName) => rows.find(r => r[0] === 'בי״ס א' && r[1] === rowName);

// ── main ─────────────────────────────────────────────────────────
const tabs = gidsFromDashboard();
const base = () => Object.fromEntries(tabs.map((t, i) => [t.gid, buildSheet(1000 + i * 7, { periodShift: i * 4 })]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holon-audit-'));

let pass = 0, fail = 0;
const say = (ok, name, extra = '') => {
  console.log(`  ${ok ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m'} ${name}${extra ? '  \x1b[2m' + extra + '\x1b[0m' : ''}`);
  ok ? pass++ : fail++;
};

console.log('\n\x1b[1mבדיקה עצמית — בודק המהימנות\x1b[0m\n');

// 1. גיליון נקי חייב לעבור
console.log('\x1b[2mבסיס\x1b[0m');
const cleanDir = path.join(tmp, 'clean');
writeSet(cleanDir, base());
const clean = runAudit(cleanDir);
const cleanErrs = clean.findings.filter(f => f.severity === 'error');
say(clean.verdict !== 'fail', 'גיליון תקין עובר ללא שגיאות',
    cleanErrs.length ? cleanErrs.slice(0, 3).map(f => f.code + ': ' + f.message).join(' | ') : `${clean.stats.parity.cells} תאים · ${clean.stats.oracle.matched}/${clean.stats.oracle.compared} הצלבות`);
say(clean.stats.parity.diffs === 0, 'הפרסר של הדשבורד תואם לחישוב העצמאי');
say(clean.stats.oracle.compared > 0 && clean.stats.oracle.matched === clean.stats.oracle.compared,
    'כל ההצלבות מול «סה״כ עיר» תואמות');
say(clean.stats.metrics.bad === 0 && clean.stats.metrics.n > 0, 'המדדים תואמים');
say(clean.stats.render.bad === 0 && clean.stats.render.n > 0, 'המספרים שנכתבו למסך תואמים');

// 2. כל פגם חייב להיתפס
console.log('\n\x1b[2mהזרקת פגמים\x1b[0m');
for (const f of FAULTS){
  const dir = path.join(tmp, f.code);
  const sets = base();
  f.hit(sets, tabs[0].gid, tabs);
  writeSet(dir, sets);
  const res = runAudit(dir);
  const got = res.findings.find(x => x.code === f.code);
  say(!!got, f.what, got ? got.message.slice(0, 90) : `לא נתפס (קוד ${f.code})`);
}

// 3. פגמים בקוד הדשבורד עצמו, לא בנתונים.
// הנתונים תקינים לגמרי; מה שמשתנה הוא index.html. אם השכבות שמשוות
// את הדשבורד לחישוב העצמאי לא יורות כאן — הן לא באמת משוות כלום.
console.log('\n\x1b[2mפגמים בקוד הדשבורד\x1b[0m');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dir = path.join(tmp, 'codefault');
  writeSet(dir, base());

  const MUTATIONS = [
    { code:'parser_diff', what:'הפרסר מחליף בין פיזיקה למדמ״ח',
      from:'grades[g]=[ total, cs, ph,', to:'grades[g]=[ total, ph, cs,' },
    { code:'render_diff', what:'המדד של שכבה יא׳ נכתב לכרטיס של שכבה י׳',
      from:"document.getElementById('kPct10').innerHTML = p10.toFixed(1)",
      to:  "document.getElementById('kPct10').innerHTML = p11.toFixed(1)" },
  ];

  for (const m of MUTATIONS){
    if (!html.includes(m.from)){ say(false, m.what, 'עוגן המוטציה לא נמצא ב-index.html — יש לעדכן את המבחן'); continue; }
    const file = path.join(tmp, `dash-${m.code}.html`);
    fs.writeFileSync(file, html.replace(m.from, m.to));
    const res = runAudit(dir, ['--dashboard', file]);
    const got = res.findings.find(x => x.code === m.code);
    say(!!got, m.what, got ? got.message.slice(0, 90) : `לא נתפס (קוד ${m.code})`);
  }
}

// 4. עמידות בפני צורות שורה שהגיליון האמיתי מייצר
console.log('\n\x1b[2mעמידות הפרסר\x1b[0m');
{
  // שורות מקוצצות: חלק מהיצואנים משמיטים תאים ריקים בסוף השורה
  const dir = path.join(tmp, 'ragged');
  const sets = base();
  for (const rows of Object.values(sets))
    for (const r of rows) { while (r.length && r[r.length - 1] === '') r.pop(); }
  writeSet(dir, sets);
  const res = runAudit(dir);
  say(res.verdict !== 'fail', 'שורות בלי תאים ריקים בסוף',
      res.findings.filter(f => f.severity === 'error').slice(0, 2).map(f => f.message).join(' | ') || 'נקרא זהה');

  // BOM ושורות ריקות מפוזרות
  const dir2 = path.join(tmp, 'bom');
  fs.mkdirSync(dir2, { recursive:true });
  const sets2 = base();
  for (const [gid, rows] of Object.entries(sets2)){
    const withBlanks = [];
    rows.forEach((r, i) => { withBlanks.push(r); if (i % 17 === 0) withBlanks.push([]); });
    fs.writeFileSync(path.join(dir2, gid + '.csv'), '﻿' + toCsv(withBlanks));
  }
  const res2 = runAudit(dir2);
  say(res2.verdict !== 'fail', 'BOM בתחילת הקובץ ושורות ריקות מפוזרות',
      res2.findings.filter(f => f.severity === 'error').slice(0, 2).map(f => f.message).join(' | ') || 'נקרא זהה');

  // הדפוס של «הראל» בגיליון האמיתי: פיזיקה 13, מדמ״ח 21, זכאות 16.
  // הזכאות קטנה מהמקצוע הגדול שבתוכה — וזו שורה כשרה. אסור שתידלק.
  const dir3 = path.join(tmp, 'harel');
  const sets3 = Object.fromEntries(tabs.map((t, i) =>
    [t.gid, buildSheet(1000 + i * 7, { periodShift: i * 4, eligibilityBelow: true })]));
  writeSet(dir3, sets3);
  const res3 = runAudit(dir3);
  const bogus = res3.findings.filter(f => f.severity === 'error');
  say(!bogus.length, 'זכאות קטנה מפיזיקה/מדמ״ח — דפוס אמיתי, לא ממצא',
      bogus.length ? bogus.slice(0, 2).map(f => f.code + ': ' + f.message).join(' | ') : 'לא הודלקה התרעת שווא');
}

// 5. פער בין המקור לפרסום
console.log('\n\x1b[2mפרסום מול מקור\x1b[0m');
{
  const pub = path.join(tmp, 'pub'), src = path.join(tmp, 'src');
  const a = base(); writeSet(pub, a);
  const b = base(); find(b[tabs[0].gid], 'זכאות למדד טק')[22] = '999'; writeSet(src, b);
  const res = runAudit(pub, ['--source-dir', src]);
  const got = res.findings.find(x => x.code === 'publish_stale');
  say(!!got, 'CSV מפורסם שאינו מסונכרן עם גיליון המקור', got ? got.message.slice(0, 90) : 'לא נתפס');

  writeSet(src, base());
  const res2 = runAudit(pub, ['--source-dir', src]);
  say(!res2.findings.some(x => x.code === 'publish_stale'), 'מקור זהה — אין התרעת שווא');
}

// --keep משאיר את הגיליונות הסינתטיים על הדיסק, לבדיקה ידנית של הדוח
if (process.argv.includes('--keep')) console.log(`\n  \x1b[2mהגיליונות נשארו ב-${tmp}\x1b[0m`);
else fs.rmSync(tmp, { recursive:true, force:true });
console.log(`\n  ${fail ? '\x1b[31m' : '\x1b[32m'}${pass} עברו, ${fail} נכשלו\x1b[0m\n`);
process.exit(fail ? 1 : 0);
