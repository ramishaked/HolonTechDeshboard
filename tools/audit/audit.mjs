#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// בודק מהימנות נתונים — דשבורד מדד בגרות-טק חולון
//
// שואל שאלה אחת: האם המספרים שהדשבורד יציג זהים למה שכתוב בגיליון?
// אינו מניח דבר. אינו קורא לפונקציות החישוב של הדשבורד כדי לאמת את
// עצמן — הוא מפרסר ומחשב הכל מחדש, לבד, ישירות מהמפרט, ואז משווה.
//
// חמש שכבות, מהגולמי אל המסך:
//   L0  גיליון המקור            (--source-dir, אופציונלי)
//   L1  ה-CSV המפורסם           ← מה שהדשבורד באמת אוכל
//   L2  חישוב עצמאי             ← המימוש שבקובץ הזה, לפי המפרט §3.3
//   L3  קוד הדשבורד             ← index.html רץ באמת, בארגז חול
//   L4  המחרוזות שנכתבו למסך    ← מה שהמשתמש רואה בפועל
//
// כל שכבה מושווית לזו שלפניה. פער בין שתיים = ממצא.
// בנוסף: הצלבה מול שורות "סה״כ עיר" שבגיליון — אורקל שהדשבורד
// עצמו מתעלם ממנו במכוון (§3.1), ולכן הוא עד חיצוני כשר.
//
// שימוש:  node tools/audit/audit.mjs [אפשרויות]
// ════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// ── קבועים מהמפרט (§2). מוגדרים כאן מחדש ולא מיובאים מהדשבורד — ──
// ── זו כל הנקודה: שני מקורות בלתי תלויים לאותה אמת.              ──
const ALL_GRADES = ['ז','ח','ט','י','יא','יב'];
const HIGH_GRADES = ['י','יא','יב'];                 // בסיס המדד העירוני
const BASE = gi => 2 + gi * 6;                       // §2, מבנה הבלוקים
const OFF = { boys:0, girls:1, total:2, pBoys:3, pGirls:4, pTotal:5 };

// תשע שורות התקן (§2). המפתח הוא השם אחרי נרמול.
const ROW_SPEC = {
  'כמותתלמידים' : { key:'total', label:'כמות תלמידים', denom:true },
  'פיזיקה5יח'   : { key:'ph',    label:'פיזיקה 5 יח׳' },
  'מדעיהמחשב5יח': { key:'cs',    label:'מדעי המחשב 5 יח׳' },
  'מתמטיקה3יח'  : { key:'ma3',   label:'מתמטיקה 3 יח׳' },
  'מתמטיקה4יח'  : { key:'ma4',   label:'מתמטיקה 4 יח׳' },
  'מתמטיקה5יח'  : { key:'ma5',   label:'מתמטיקה 5 יח׳' },
  'אנגלית5יח'   : { key:'en5',   label:'אנגלית 5 יח׳' },
  'עתידטק'      : { key:'ft',    label:'עתיד טק' },
  'זכאותלמדדטק' : { key:'ht',    label:'זכאות למדד טק', metric:true },
};
const ROW_KEYS = Object.values(ROW_SPEC).map(r => r.key);

// ── נרמול. מקביל ל-_strip/_clean שבדשבורד, במימוש נפרד. ──────────
const norm  = v => String(v ?? '').replace(/[׳״'"״׳`]/g, '').replace(/\s+/g, '');
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

// שם טאב → שנה וחצי-שנה. משכפל במכוון את parsePeriodName של הדשבורד:
// סדר התקופות הוא שלו, ובדיקת ההיגיון בין תקופות חייבת לרוץ על אותו ציר.
const GEM = { א:1,ב:2,ג:3,ד:4,ה:5,ו:6,ז:7,ח:8,ט:9,י:10,כ:20,ך:20,ל:30,מ:40,ם:40,
              נ:50,ן:50,ס:60,ע:70,פ:80,ף:80,צ:90,ץ:90,ק:100,ר:200,ש:300,ת:400 };
function periodMeta(raw){
  const bare = norm(raw);
  const half = /\(?2\)?$|סוףשנה|סוף/.test(bare) ? 2
             : /\(?1\)?$|תחילתשנה|תחילת/.test(bare) ? 1 : 1;
  const core = bare.replace(/סוףשנה|תחילתשנה|תחילת|תחילה|סוף|שנה/g, '');
  const y = core.match(/^ת[א-ת]{2,4}/);
  if (!y) return { year:0, half };
  let v = [...y[0]].reduce((s, c) => s + (GEM[c] || 0), 0);
  if (v < 1000) v += 5000;
  return { year: v - 3760, half };
}

function num(v){
  if (v == null) return null;
  const t = String(v).replace(/[,%\s‏‎]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;      // NaN = תא לא-מספרי, בניגוד ל-null = ריק
}

// ════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════
function parseArgs(argv){
  const o = { sample:6, seed:null, json:false, verbose:false, fromDir:null,
              sourceDir:null, gid:null, baseline:true, writeBaseline:false,
              timeout:25000, jumpPct:50, jumpAbs:25 };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i], next = () => argv[++i];
    switch (a){
      case '--sample':          o.sample = +next(); break;
      case '--seed':            o.seed = +next(); break;
      case '--json':            o.json = true; break;
      case '--verbose': case '-v': o.verbose = true; break;
      case '--from-dir':        o.fromDir = next(); break;
      case '--dashboard':       o.dashboard = next(); break;
      case '--source-dir':      o.sourceDir = next(); break;
      case '--gid':             o.gid = next(); break;
      case '--no-baseline':     o.baseline = false; break;
      case '--write-baseline':  o.writeBaseline = true; break;
      case '--timeout':         o.timeout = +next(); break;
      case '--jump-pct':        o.jumpPct = +next(); break;
      case '--jump-abs':        o.jumpAbs = +next(); break;
      case '--help': case '-h': o.help = true; break;
      default:
        if (a.startsWith('-')) { console.error('אפשרות לא מוכרת: ' + a); process.exit(2); }
    }
  }
  return o;
}

const HELP = `
בודק מהימנות נתונים — דשבורד מדד בגרות-טק חולון

  node tools/audit/audit.mjs [אפשרויות]

  --from-dir <נתיב>     לקרוא CSV מהדיסק (<gid>.csv) במקום מהרשת
  --source-dir <נתיב>   גיליון המקור לפני הפרסום, להשוואה מול המפורסם
  --gid <id>            לבדוק טאב אחד בלבד
  --sample N            כמה תאים אקראיים לעקוב מקצה לקצה (ברירת מחדל 6)
  --seed N              זרע קבוע לדגימה, לשחזור
  --jump-pct N          סף הקפיצה בין תקופות באחוזים (ברירת מחדל 50)
  --jump-abs N          סף הקפיצה במספר תלמידים (ברירת מחדל 25)
  --dashboard <נתיב>    לבדוק index.html אחר
  --write-baseline      לשמור את המצב הנוכחי כקו בסיס להשוואות הבאות
  --no-baseline         לא להשוות מול קו הבסיס
  --json                פלט מכונה
  -v, --verbose         לפרט כל ממצא ולא רק את הראשונים
`;

// ════════════════════════════════════════════════════════════════
// L0/L1 — הוצאת התצורה מ-index.html ואיסוף ה-CSV
// ════════════════════════════════════════════════════════════════

// קוראים את ה-PUB ואת ה-GID_MAP מהדשבורד עצמו. לא משכפלים אותם לכאן,
// כדי שהבדיקה תרוץ תמיד מול הטאבים שהדשבורד באמת מושך.
function readDashboard(override){
  const file = override ? path.resolve(override) : path.join(ROOT, 'index.html');
  const html = fs.readFileSync(file, 'utf8');

  const build = (html.match(/const\s+BUILD\s*=\s*'([^']+)'/) || [])[1] || '?';
  const pubStmt = html.match(/const\s+PUB\s*=\s*([\s\S]*?);\n/);
  if (!pubStmt) throw new Error('לא נמצא const PUB ב-index.html');
  const PUB = Function('"use strict";return (' + pubStmt[1] + ')')();

  const mapBlock = html.match(/const\s+GID_MAP\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!mapBlock) throw new Error('לא נמצא const GID_MAP ב-index.html');
  const GID_MAP = {};
  for (const m of mapBlock[1].matchAll(/'([^']+)'\s*:\s*'(\d+)'/g)) GID_MAP[m[1]] = m[2];

  // ה-ROWKEY של הדשבורד — כדי לוודא שאוצר המילים שלו זהה למפרט
  const rkBlock = html.match(/const\s+ROWKEY\s*=\s*\{([\s\S]*?)\}\s*;/);
  const ROWKEY = {};
  if (rkBlock) for (const m of rkBlock[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) ROWKEY[m[1]] = m[2];

  const national = +((html.match(/let\s+NATIONAL\s*=\s*([\d.]+)/) || [])[1] || NaN);

  // הסקריפט הפנימי (האחרון) — לארגז החול
  const tags = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  if (!tags.length) throw new Error('לא נמצא סקריפט פנימי ב-index.html');
  const script = tags[tags.length - 1][1];

  return { html, file, build, PUB, GID_MAP, ROWKEY, national, script };
}

async function fetchCsv(PUB, gid, timeout){
  const url = PUB + '?output=csv&single=true' + (gid ? '&gid=' + gid : '') + '&_=' + Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if (/^\s*<(!DOCTYPE|html)/i.test(text)) throw new Error('התקבל HTML במקום CSV — הגיליון כנראה אינו מפורסם');
    return text;
  } catch (e){
    if (e.name === 'AbortError') throw new Error('הבקשה לא נענתה תוך ' + (timeout / 1000) + ' שניות');
    throw e;
  } finally { clearTimeout(t); }
}

function readCsvDir(dir, gid){
  for (const name of [gid + '.csv', gid + '.CSV']){
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return null;
}

// ── פרסר CSV עצמאי ───────────────────────────────────────────────
// מימוש נפרד מזה שבדשבורד. אם שניהם מסכימים על אותם בתים — הפרסינג נקי.
function csvParse(text){
  const out = [];
  let row = [], field = '', quoted = false, i = 0;
  const s = text.replace(/\r\n?/g, '\n');
  while (i < s.length){
    const c = s[i];
    if (quoted){
      if (c !== '"') { field += c; i++; continue; }
      if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
      quoted = false; i++; continue;
    }
    if (c === '"')  { quoted = true; i++; continue; }
    if (c === ',')  { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); field = ''; out.push(row); row = []; i++; continue; }
    field += c; i++;
  }
  row.push(field); out.push(row);
  return out;
}

// ════════════════════════════════════════════════════════════════
// L2 — המודל העצמאי
// ════════════════════════════════════════════════════════════════
//   schools : Map<שם, {rows: {rowKey: {grade: cell}}, lines: []}>
//   cityRow : שורות "סה״כ עיר" — האורקל החיצוני
//   matzevet: שורת המצבת
// cell = { boys, girls, total, pBoys, pGirls, pTotal, line, cols }
function buildModel(rows, findings, ctx){
  const schools = new Map();
  const cityRow = {}, matzevet = {};
  const seen = new Set();
  let dataLines = 0;

  rows.forEach((r, li) => {
    if (!r || r.length < 3) return;
    const rawSchool = clean(r[0]), sKey = norm(r[0]);
    if (!sKey || sKey === 'ביתספר' || sKey === 'מקצועות') return;

    const readBlocks = () => {
      const g = {};
      ALL_GRADES.forEach((grade, gi) => {
        const b = BASE(gi);
        const cell = {
          boys:   num(r[b + OFF.boys]),   girls:  num(r[b + OFF.girls]),
          total:  num(r[b + OFF.total]),  pBoys:  num(r[b + OFF.pBoys]),
          pGirls: num(r[b + OFF.pGirls]), pTotal: num(r[b + OFF.pTotal]),
          line: li + 1,
        };
        if (cell.boys != null || cell.girls != null || cell.total != null) g[grade] = cell;
      });
      return g;
    };

    if (sKey === 'מצבת'){
      const g = readBlocks();
      ALL_GRADES.forEach(grade => { if (g[grade]?.total != null) matzevet[grade] = g[grade].total; });
      return;
    }

    const rk = ROW_SPEC[norm(r[1])];

    if (sKey === 'סהכעיר'){                       // האורקל (§3.1) — לא מקור, עד
      if (rk) cityRow[rk.key] = readBlocks();
      return;
    }

    if (!rk){
      if (clean(r[1])) findings.push(F('error', 'row_vocabulary',
        `שורה לא מזוהה: «${rawSchool}» / «${clean(r[1])}»`,
        { ...ctx, line: li + 1 },
        'הדשבורד יזרוק את השורה הזו בשקט (parseSheet דוחף ל-warnings ולא מציג). ' +
        'אם זו שורת נתונים אמיתית — המספרים שלה חסרים מכל חישוב.'));
      return;
    }

    dataLines++;
    if (!schools.has(rawSchool)) schools.set(rawSchool, { rows:{}, lines:[] });
    const S = schools.get(rawSchool);
    S.lines.push(li + 1);

    const dupKey = rawSchool + '|' + rk.key;
    if (seen.has(dupKey)) findings.push(F('error', 'duplicate_row',
      `«${rawSchool}» / «${rk.label}» מופיעה יותר מפעם אחת`, { ...ctx, line: li + 1 },
      'הדשבורד ידרוס את המופע הראשון בשני. איזה מהם נכון — לא ניתן לדעת מהקוד.'));
    seen.add(dupKey);

    S.rows[rk.key] = readBlocks();
  });

  return { schools, cityRow, matzevet, dataLines };
}

const F = (severity, code, message, where = {}, why = '') => ({ severity, code, message, where, why });

// ── §3.3 — הנוסחאות, במימוש עצמאי ────────────────────────────────
const cellOf  = (S, key, g) => S.rows[key]?.[g] || null;
const valOf   = (S, key, g) => cellOf(S, key, g)?.total ?? 0;
const hasGrade = (S, g) => (cellOf(S, 'total', g)?.total || 0) > 0;

function aggregate(model){
  const A = { byGrade:{}, tech:{}, students:{}, pct:{}, subj:{} };
  for (const g of ALL_GRADES){
    let tech = 0, students = 0;
    const subj = {};
    for (const k of ROW_KEYS) subj[k] = 0;
    for (const [, S] of model.schools){
      if (!hasGrade(S, g)) continue;
      students += valOf(S, 'total', g);
      tech     += valOf(S, 'ht', g);
      for (const k of ROW_KEYS) subj[k] += valOf(S, k, g);
    }
    A.tech[g] = tech; A.students[g] = students;
    A.pct[g] = students ? tech / students * 100 : 0;
    A.subj[g] = subj;
  }
  // מדד עירוני משוקלל י׳–יב׳ + נשירה (§3.3)
  let t = 0, s = 0;
  for (const g of HIGH_GRADES){ t += A.tech[g]; s += A.students[g]; }
  A.overallTech = t; A.overallStudents = s;
  A.overallPct = s ? t / s * 100 : 0;
  A.dropPct = A.pct['י'] ? (A.pct['י'] - A.pct['יב']) / A.pct['י'] * 100 : null;
  return A;
}

// ════════════════════════════════════════════════════════════════
// הבדיקות
// ════════════════════════════════════════════════════════════════

// ── מבנה וגיאומטריה — סריקה מלאה, לא מדגם ────────────────────────
function checkStructure(model, findings, ctx){
  const nSchools = model.schools.size;
  if (!nSchools) findings.push(F('error', 'no_schools', 'לא נמצא אף בית ספר בטאב', ctx));

  for (const [name, S] of model.schools){
    // כל תשע שורות התקן קיימות?
    const missing = Object.values(ROW_SPEC).filter(r => !S.rows[r.key]).map(r => r.label);
    if (missing.length) findings.push(F('warn', 'missing_rows',
      `«${name}» — חסרות ${missing.length} משורות התקן: ${missing.join(', ')}`, ctx,
      'שורה חסרה נספרת כאפס בכל חישוב, ואי אפשר להבחין בינה לבין אפס אמיתי.'));

    for (const [key, byGrade] of Object.entries(S.rows)){
      const label = Object.values(ROW_SPEC).find(r => r.key === key).label;
      for (const [g, c] of Object.entries(byGrade)){
        const at = { ...ctx, line: c.line, school:name, grade:g, row:label };

        for (const f of ['boys','girls','total']){
          if (Number.isNaN(c[f])) findings.push(F('error', 'non_numeric',
            `«${name}» / «${label}» / שכבה ${g} — התא ${f} אינו מספר`, at,
            'הפרסר יקרא null ויתייחס לזה כאל היעדר נתון.'));
          else if (c[f] != null && c[f] < 0) findings.push(F('error', 'negative',
            `«${name}» / «${label}» / שכבה ${g} — ערך שלילי (${c[f]})`, at));
        }

        // בנים + בנות = סה״כ
        if (c.boys != null && c.girls != null && c.total != null && !Number.isNaN(c.boys + c.girls + c.total)){
          if (c.boys + c.girls !== c.total) findings.push(F('error', 'gender_sum',
            `«${name}» / «${label}» / שכבה ${g} — ${c.boys}+${c.girls}≠${c.total}`, at,
            'הדשבורד לוקח את סה״כ למונה ואת הבנות לפילוח המגדרי. אם הם לא מתיישבים, ' +
            'שני המספרים על המסך סותרים זה את זה.'));
        }

        // עמודות האחוזים של הגיליון מול היחס בפועל
        const denom = valOf(S, 'total', g);
        if (denom > 0 && c.pTotal != null && !Number.isNaN(c.pTotal) && c.total != null && key !== 'total'){
          const real = c.total / denom * 100;
          if (Math.abs(real - c.pTotal) > 1.5) findings.push(F('warn', 'pct_mismatch',
            `«${name}» / «${label}» / שכבה ${g} — הגיליון כותב ${c.pTotal}% אך ${c.total}/${denom} הם ${real.toFixed(1)}%`, at,
            'הדשבורד מתעלם מעמודות האחוזים ומחשב לבד, אז המסך לא יושפע — ' +
            'אבל פער כזה מרמז שאחד משני המספרים הוזן שגוי.'));
        }
      }
    }

    // ── אינווריאנטות סמנטיות ──
    for (const g of ALL_GRADES){
      const total = valOf(S, 'total', g);
      const at = { ...ctx, school:name, grade:g };
      if (!hasGrade(S, g)){
        const stray = ROW_KEYS.filter(k => k !== 'total' && valOf(S, k, g) > 0);
        if (stray.length) findings.push(F('error', 'orphan_values',
          `«${name}» שכבה ${g} — אין «כמות תלמידים» אך יש ערכים ב-${stray.length} שורות`, at,
          'הפרסר מדלג על שכבה בלי total (parseSheet: if(!total) return), ' +
          'ולכן הנתונים האלה נעלמים מהדשבורד לגמרי.'));
        continue;
      }

      for (const k of ROW_KEYS){
        if (k === 'total') continue;
        const v = valOf(S, k, g);
        const label = Object.values(ROW_SPEC).find(r => r.key === k).label;
        if (v > total) findings.push(F('error', 'exceeds_total',
          `«${name}» / «${label}» / שכבה ${g} — ${v} לומדים מתוך ${total} תלמידים`, at,
          'יותר לומדי מקצוע מתלמידים בשכבה. אחד משני המספרים שגוי.'));
        const c = cellOf(S, k, g);
        if (c && c.girls != null && c.total != null && c.girls > c.total) findings.push(F('error', 'girls_exceed',
          `«${name}» / «${label}» / שכבה ${g} — ${c.girls} בנות מתוך ${c.total} לומדים`, at));
      }

      // אין כאן בדיקה על היחס בין «זכאות למדד טק» לפיזיקה/מדמ״ח — במכוון.
      // נבדק מול הגיליון: הראל שכבה י׳ — פיזיקה 13, מדמ״ח 21, זכאות 16;
      // שכבה ח׳ — פיזיקה 89, מדמ״ח 36, זכאות 27. הזכאות אינה איחוד הלומדים
      // אלא קריטריון נפרד וצר יותר, ולכן גם max(ph,cs) ≤ ht וגם ht ≤ ph+cs
      // נופלים על נתונים אמיתיים ותקינים. גלאי שמתריע על שורות כשרות
      // מלמד את המשתמש להתעלם ממנו, וזה גרוע מלא לבדוק בכלל.
      // מה שכן נבדק כאן: כל שורה ≤ «כמות תלמידים», למעלה.
    }
  }

  // המצבת אמורה להיות ≥ סכום בתי הספר (רישום משרד החינוך מכיל את מה שהעיר מכירה)
  const A = aggregate(model);
  for (const g of ALL_GRADES){
    const m = model.matzevet[g];
    if (m == null || !A.students[g]) continue;
    if (m < A.students[g]) findings.push(F('warn', 'matzevet_below',
      `שכבה ${g} — מצבת ${m} קטנה מסכום בתי הספר ${A.students[g]}`, ctx,
      'המצבת אמורה להיות המספר הרחב יותר. היפוך מרמז על טאב מעורבב או שורה שלא עודכנה.'));
  }
  return A;
}

// ── הצלבה מול "סה״כ עיר" — עד חיצוני שהדשבורד לא נוגע בו ─────────
function checkCityOracle(model, findings, ctx){
  let compared = 0, matched = 0;
  if (!Object.keys(model.cityRow).length){
    findings.push(F('info', 'no_oracle', 'אין שורות «סה״כ עיר» בטאב — אין הצלבה חיצונית', ctx));
    return { compared, matched };
  }
  for (const [key, byGrade] of Object.entries(model.cityRow)){
    const label = Object.values(ROW_SPEC).find(r => r.key === key).label;
    for (const g of ALL_GRADES){
      const stated = byGrade[g]?.total;
      if (stated == null || Number.isNaN(stated)) continue;
      let mine = 0;
      for (const [, S] of model.schools){
        if (key !== 'total' && !hasGrade(S, g)) continue;
        mine += valOf(S, key, g);
      }
      compared++;
      if (mine === stated) { matched++; continue; }
      findings.push(F('error', 'oracle_mismatch',
        `«${label}» שכבה ${g} — סכום בתי הספר ${mine}, אך «סה״כ עיר» בגיליון כותב ${stated} (פער ${mine - stated})`,
        { ...ctx, row:label, grade:g },
        'שני המספרים בגיליון סותרים זה את זה. הדשבורד יציג את הסכום העצמאי (' + mine + ') — ' +
        'אבל אחד מהשניים שגוי, וצריך להכריע ידנית איזה.'));
    }
  }
  return { compared, matched };
}

// ── היגיון בין תקופות — "האם המספרים הגיוניים" ───────────────────
function checkPlausibility(periods, findings, opt){
  const ordered = periods.filter(p => p.model).sort((a, b) => (a.year - b.year) || (a.half - b.half));
  for (let i = 1; i < ordered.length; i++){
    const prev = ordered[i - 1], cur = ordered[i];
    const at = { period: cur.label };

    const prevNames = new Set(prev.model.schools.keys());
    const curNames  = new Set(cur.model.schools.keys());
    for (const n of prevNames) if (!curNames.has(n)) findings.push(F('warn', 'school_gone',
      `«${n}» היה ב-${prev.label} ונעלם ב-${cur.label}`, at,
      'בית ספר שנעלם מוריד את המונה ואת המכנה גם יחד — המדד העירוני זז בלי שקרה כלום בשטח.'));
    for (const n of curNames) if (!prevNames.has(n)) findings.push(F('info', 'school_new',
      `«${n}» חדש ב-${cur.label}`, at));

    // שורה שהיו בה נתונים והתרוקנה — הדפוס של «עתיד טק» ב-תשפ״ו (2)
    for (const k of ROW_KEYS){
      if (k === 'total') continue;
      const label = Object.values(ROW_SPEC).find(r => r.key === k).label;
      const sum = m => ALL_GRADES.reduce((s, g) => s + [...m.schools.values()]
        .reduce((x, S) => x + valOf(S, k, g), 0), 0);
      const before = sum(prev.model), after = sum(cur.model);
      if (before > 0 && after === 0) findings.push(F('warn', 'field_emptied',
        `«${label}» — ${before} לומדים ב-${prev.label}, אפס ב-${cur.label}`, at,
        'השורה קיימת בגיליון אך לא הוזנה. כל רכיב שמוצג עליה יראה 0, ולא "אין נתונים".'));
    }

    // קפיצות חדות ברמת בית ספר × שכבה × זכאות.
    // ממוינות לפי כמה תלמידים זזו — הכי גדולה קודם, כמו במנוע הגלאים
    // של התצוגה. רשימה ארוכה ולא ממוינת שקולה לאין רשימה.
    const jumps = [];
    for (const [name, S] of cur.model.schools){
      const P = prev.model.schools.get(name);
      if (!P) continue;
      for (const g of ALL_GRADES){
        const a = valOf(P, 'ht', g), b = valOf(S, 'ht', g);
        if (!a && !b) continue;
        const dAbs = Math.abs(b - a);
        const dRel = a ? dAbs / a * 100 : 100;
        if (dAbs >= opt.jumpAbs && dRel >= opt.jumpPct) jumps.push({ name, g, a, b, dAbs, dRel });
      }
    }
    jumps.sort((x, y) => y.dAbs - x.dAbs);
    for (const j of jumps) findings.push(F('warn', 'sharp_jump',
      `«${j.name}» שכבה ${j.g} — זכאות ${j.a}→${j.b} (${j.b > j.a ? '+' : '−'}${j.dRel.toFixed(0)}%, ${j.dAbs} תלמידים) בין ${prev.label} ל-${cur.label}`,
      { ...at, school:j.name, grade:j.g },
      'שינוי בסדר גודל כזה בין שתי דגימות הוא בדרך כלל הזנה, לא תנועה אמיתית של תלמידים.'));
  }
}

// ════════════════════════════════════════════════════════════════
// L3/L4 — הרצת index.html בארגז חול
// ════════════════════════════════════════════════════════════════
// לא מדמים את הדשבורד — מריצים אותו. אותו קוד בדיוק, על אותם בתים,
// עם DOM מזויף שמקליט כל מחרוזת שנכתבת אליו.
function makeSandbox(dash, csvByGid){
  const els = new Map();
  const el = id => {
    if (els.has(id)) return els.get(id);
    const set = new Set();
    const node = {
      id, textContent:'', innerHTML:'', value:'', className:'', disabled:false,
      style:{}, dataset:{}, onchange:null,
      classList:{ add:(...c) => c.forEach(x => set.add(x)), remove:(...c) => c.forEach(x => set.delete(x)),
                  contains:c => set.has(c), toggle:c => set.has(c) ? set.delete(c) : set.add(c) },
      addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){},
      setAttribute(){}, getAttribute(){ return null; }, focus(){}, click(){},
      getContext(){ return {}; },
      querySelector(){ return el(id + '>q'); }, querySelectorAll(){ return []; },
    };
    els.set(id, node);
    return node;
  };

  function Chart(_ctx, cfg){ this.config = cfg; }
  Chart.prototype.destroy = function(){};
  Chart.prototype.update  = function(){};
  Chart.register = () => {};

  const errors = [];
  const store = new Map();

  const sandbox = {
    console:{ log(){}, warn(){}, error:(...a) => errors.push(a.map(String).join(' ')), info(){} },
    document:{
      getElementById: el,
      querySelector: sel => el('sel:' + sel),
      querySelectorAll: () => [],
    },
    window:{ addEventListener(){}, removeEventListener(){} },
    localStorage:{ getItem:k => store.has(k) ? store.get(k) : null,
                   setItem:(k, v) => store.set(k, String(v)),
                   removeItem:k => store.delete(k) },
    Chart, ChartDataLabels:{},
    alert(){},
    setTimeout, clearTimeout, AbortController, Date, Math, JSON, Intl,
    // fetch מזויף: מגיש בדיוק את הבתים שכבר בדקנו, בלי רשת ובלי הפתעות
    async fetch(url){
      const gid = (String(url).match(/[?&]gid=(\d+)/) || [])[1] || '';
      const body = csvByGid[gid];
      if (body == null) return { ok:false, status:404, async text(){ return ''; } };
      return { ok:true, status:200, async text(){ return body; } };
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.document = sandbox.document;

  const ctx = vm.createContext(sandbox);
  // מנטרלים את הקריאה האוטומטית ל-boot() כדי שנוכל לחכות לה
  const src = dash.script.replace(/\nboot\(\);\s*$/, '\n');
  vm.runInContext(src, ctx, { filename:'index.html' });
  return { ctx, els, errors };
}

async function runDashboard(dash, csvByGid, findings){
  let box;
  try { box = makeSandbox(dash, csvByGid); }
  catch (e){
    findings.push(F('error', 'script_throw', 'קוד הדשבורד נכשל בטעינה: ' + e.message, {},
      'זו שגיאה בקוד ולא בנתונים — הדף לא יעלה בכלל.'));
    return null;
  }
  const { ctx, els, errors } = box;
  const run = code => vm.runInContext(code, ctx);

  try { await run('boot(true)'); }
  catch (e){
    findings.push(F('error', 'boot_failed', 'boot() נכשל: ' + e.message, {}));
    return null;
  }

  const keys = run('Object.keys(ALLDATA)');
  const out = { periods:{}, errors, byKey:{} };

  for (const key of keys){
    // כל תצוגה מרונדרת בנפרד, כדי שכל מחרוזת שמגיעה למסך תיתפס
    run(`applyPeriod(${JSON.stringify(key)})`);
    const views = ['renderOverview','renderSubjects','renderSchools','renderDeepDive','renderGender','renderInsights'];
    const rendered = {};
    for (const fn of views){
      try { run(`typeof ${fn}==='function' && ${fn}()`); rendered[fn] = 'ok'; }
      catch (e){
        rendered[fn] = e.message;
        findings.push(F('error', 'render_throw',
          `${fn}() זרקה שגיאה בתקופה «${run('DATA_LABEL')}»: ${e.message}`, { period:key },
          'תצוגה שנופלת משאירה על המסך את המספרים של התקופה הקודמת, בלי שום סימן לכך.'));
      }
    }

    out.byKey[key] = {
      label: run('DATA_LABEL'),
      sheetName: run(`(ALLDATA[${JSON.stringify(key)}].sheetName || '')`),
      schools: run('JSON.parse(JSON.stringify(SCHOOLS))'),
      matzevet: run('JSON.parse(JSON.stringify(MATZEVET))'),
      metrics: run(`(function(){
        var g=['י','יא','יב'], o={pct:{},tech:{},students:{},subj:{}};
        g.forEach(function(x,i){ o.pct[x]=cityPct(i); o.tech[x]=cityTotal(i); o.students[x]=cityStudents(i); });
        o.overallPct=cityOverallPct();
        o.drop=(cityPct(0)? (cityPct(0)-cityPct(2))/cityPct(0)*100 : null);
        o.schoolCount=SCHOOLS.length; o.fullCount=FULL.length;
        o.techTotal=SCHOOLS.reduce(function(s,x){return s+schoolTechTotal(x);},0);
        return JSON.parse(JSON.stringify(o));
      })()`),
      rendered,
      dom: Object.fromEntries([...els].map(([id, n]) => [id, { text:n.textContent, html:n.innerHTML }])),
    };
  }
  return out;
}

// ── L2 מול L3 — המודל העצמאי מול המודל של הדשבורד ────────────────
// שדות המערך לפי CLAUDE.md: 0 total 1 cs 2 ph 3 ma5 4 ht … 10 ft 12 ma3 13 ma4 14 en5
const FIELD_AT = { total:0, cs:1, ph:2, ma5:3, ht:4, ft:10, ma3:12, ma4:13, en5:14 };

function compareModels(model, dashPeriod, findings, ctx){
  let cells = 0, diffs = 0;
  const byName = new Map(dashPeriod.schools.map(s => [s.name, s]));

  for (const n of model.schools.keys()) if (!byName.has(n)) {
    diffs++;
    findings.push(F('error', 'school_dropped',
      `«${n}» קיים בגיליון אך לא במודל של הדשבורד`, ctx,
      'הפרסר של הדשבורד זרק אותו — בדרך כלל בגלל שם שורה שלא זוהה או היעדר «כמות תלמידים».'));
  }
  for (const n of byName.keys()) if (!model.schools.has(n)) {
    diffs++;
    findings.push(F('error', 'school_invented', `«${n}» במודל של הדשבורד אך לא בגיליון`, ctx));
  }

  for (const [name, S] of model.schools){
    const D = byName.get(name);
    if (!D) continue;
    for (const g of ALL_GRADES){
      const dRow = D.grades[g];
      const mine = hasGrade(S, g);
      if (mine !== !!dRow){
        diffs++;
        findings.push(F('error', 'grade_presence',
          `«${name}» שכבה ${g} — ${mine ? 'קיימת בגיליון וחסרה בדשבורד' : 'חסרה בגיליון וקיימת בדשבורד'}`, ctx));
        continue;
      }
      if (!dRow) continue;
      for (const [key, idx] of Object.entries(FIELD_AT)){
        cells++;
        const mineV = valOf(S, key, g), dashV = dRow[idx] || 0;
        if (mineV !== dashV){
          diffs++;
          const label = Object.values(ROW_SPEC).find(r => r.key === key).label;
          findings.push(F('error', 'parser_diff',
            `«${name}» / «${label}» / שכבה ${g} — הגיליון ${mineV}, הדשבורד קרא ${dashV}`,
            { ...ctx, school:name, grade:g },
            'הפרסר של הדשבורד לא מסכים עם קריאה ישירה של אותו תא. זו תקלת פרסינג.'));
        }
      }
    }
  }
  return { cells, diffs };
}

function compareMetrics(A, dashPeriod, schoolCount, findings, ctx){
  const M = dashPeriod.metrics;
  let n = 0, bad = 0;
  const eq = (a, b, tol, what, why) => {
    n++;
    if (a == null && b == null) return;
    if (a == null || b == null || Math.abs(a - b) > tol){
      bad++;
      findings.push(F('error', 'metric_diff',
        `${what} — חישוב עצמאי ${fmt(a)}, הדשבורד ${fmt(b)}`, ctx, why));
    }
  };
  for (const g of HIGH_GRADES){
    eq(A.tech[g],     M.tech[g],     0,     `לומדי טק שכבה ${g}`);
    eq(A.students[g], M.students[g], 0,     `כמות תלמידים שכבה ${g}`);
    eq(A.pct[g],      M.pct[g],      0.001, `מדד עירוני שכבה ${g}`);
  }
  eq(A.overallPct,  M.overallPct, 0.001, 'ממוצע עירוני משוקלל');
  eq(A.dropPct,     M.drop,       0.001, 'נשירה עירונית י׳→יב׳');
  eq(A.overallTech, M.techTotal,  0,     'סך לומדי טק י׳–יב׳');
  eq(schoolCount,   M.schoolCount, 0,    'מספר בתי ספר');
  return { n, bad };
}

// ── L3 מול L4 — האם מה שנכתב למסך הוא מה שחושב ───────────────────
// שולפים את המספר הראשון מכל תא ומשווים למדד. תופס מקרה שבו הערך
// נכון אבל נכתב לכרטיס הלא נכון.
function checkRendered(A, dashPeriod, findings, ctx){
  const dom = dashPeriod.dom;
  const firstNum = s => {
    const m = String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[,‏‎]/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const expect = [
    ['kPct10',   A.pct['י'],       0.06, 'KPI מדד שכבה י׳'],
    ['kPct11',   A.pct['יא'],      0.06, 'KPI מדד שכבה יא׳'],
    ['k12Pct',   A.pct['יב'],      0.06, 'KPI מדד שכבה יב׳'],
    ['kDrop',    A.dropPct,        0.06, 'KPI נשירה י׳→יב׳'],
    ['cityAvgUp', A.overallPct,    0.06, 'ממוצע עירוני (מובילים)'],
    ['cityAvgDn', A.overallPct,    0.06, 'ממוצע עירוני (לקידום)'],
    ['metaTotal', A.overallTech,   0,    'סך לומדי טק י׳–יב׳'],
  ];
  let n = 0, bad = 0;
  for (const [id, want, tol, what] of expect){
    const node = dom[id];
    if (!node){ continue; }
    const got = firstNum(node.html || node.text);
    n++;
    if (want == null) continue;
    if (got == null || Math.abs(got - want) > tol){
      bad++;
      findings.push(F('error', 'render_diff',
        `${what} — על המסך «${clean((node.html || node.text)).replace(/<[^>]*>/g, '').slice(0, 40)}», החישוב אומר ${fmt(want)}`,
        { ...ctx, element:id },
        'המספר שחושב נכון אינו המספר שנכתב לכרטיס הזה.'));
    }
  }
  return { n, bad };
}

// ════════════════════════════════════════════════════════════════
// מדגם — עקיבה מקצה לקצה של תאים אקראיים
// ════════════════════════════════════════════════════════════════
const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

function traceSample(periods, count, seed){
  const pool = [];
  for (const p of periods){
    if (!p.model || !p.dash) continue;
    const byName = new Map(p.dash.schools.map(s => [s.name, s]));
    for (const [name, S] of p.model.schools)
      for (const g of ALL_GRADES){
        if (!hasGrade(S, g)) continue;
        for (const k of ROW_KEYS){
          const c = cellOf(S, k, g);
          if (!c || c.total == null) continue;
          pool.push({ period:p.label, name, g, k, cell:c, dash:byName.get(name) });
        }
      }
  }
  const rnd = mulberry32(seed);
  const picked = [], taken = new Set();
  while (picked.length < Math.min(count, pool.length)){
    const i = Math.floor(rnd() * pool.length);
    if (taken.has(i)) continue;
    taken.add(i); picked.push(pool[i]);
  }
  return picked.map(x => {
    const label = Object.values(ROW_SPEC).find(r => r.key === x.k).label;
    const sheet = x.cell.total;
    const dashV = x.dash?.grades?.[x.g]?.[FIELD_AT[x.k]] ?? null;
    return { period:x.period, school:x.name, grade:x.g, row:label, line:x.cell.line,
             sheet, dash:dashV, ok: sheet === dashV };
  });
}

// ════════════════════════════════════════════════════════════════
// קו בסיס — מה זז מאז הבדיקה הקודמת
// ════════════════════════════════════════════════════════════════
const BASELINE = path.join(HERE, 'baseline.json');

function snapshot(periods){
  const out = {};
  for (const p of periods){
    if (!p.agg) continue;
    const A = p.agg;
    out[p.label] = {
      schools: p.model.schools.size,
      tech: Object.fromEntries(ALL_GRADES.map(g => [g, A.tech[g]])),
      students: Object.fromEntries(ALL_GRADES.map(g => [g, A.students[g]])),
      overallPct: +A.overallPct.toFixed(4),
      dropPct: A.dropPct == null ? null : +A.dropPct.toFixed(4),
    };
  }
  return out;
}

function diffBaseline(now, findings){
  if (!fs.existsSync(BASELINE)) return { status:'none' };
  let old;
  try { old = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).snapshot; }
  catch { return { status:'unreadable' }; }
  const changes = [];
  const walk = (a, b, trail) => {
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])){
      const va = a?.[k], vb = b?.[k];
      if (va && typeof va === 'object' || vb && typeof vb === 'object') walk(va, vb, [...trail, k]);
      else if (va !== vb) changes.push({ path:[...trail, k].join(' · '), from:va, to:vb });
    }
  };
  walk(old, now, []);
  for (const c of changes) findings.push(F('info', 'drift',
    `${c.path}: ${fmt(c.from)} → ${fmt(c.to)}`, {},
    'השתנה מאז קו הבסיס האחרון. אם לא ערכת את הגיליון — זה מה שצריך לבדוק.'));
  return { status:'ok', changes: changes.length };
}

// ════════════════════════════════════════════════════════════════
// דוח
// ════════════════════════════════════════════════════════════════
const fmt = v => v == null ? '—'
  : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('he-IL') : v.toFixed(1))
  : String(v);

const C = process.stdout.isTTY
  ? { dim:'\x1b[2m', red:'\x1b[31m', yel:'\x1b[33m', grn:'\x1b[32m', bold:'\x1b[1m', off:'\x1b[0m' }
  : { dim:'', red:'', yel:'', grn:'', bold:'', off:'' };

function report(state, opt){
  const { findings, periods, stats, dash, elapsed } = state;
  // חסימה אינה שגיאה בנתונים. טאב שלא נטען מוצג בנפרד, כדי שלא ייקרא
  // כאילו נמצא פער בין הגיליון למסך.
  const blocked = findings.filter(f => f.code === 'load_failed');
  const errs  = findings.filter(f => f.severity === 'error' && f.code !== 'load_failed');
  const warns = findings.filter(f => f.severity === 'warn');
  const infos = findings.filter(f => f.severity === 'info');
  const L = [];
  const MARK = { ok:`${C.grn}✔${C.off}`, warn:`${C.yel}⚠${C.off}`, bad:`${C.red}✘${C.off}`, skip:`${C.dim}–${C.off}` };

  L.push('');
  L.push(`${C.bold}בדיקת מהימנות נתונים${C.off}  ${C.dim}·  דשבורד ${dash.build}  ·  ${periods.length} תקופות  ·  ${(elapsed / 1000).toFixed(1)} שנ׳${C.off}`);
  L.push('');

  const line = (name, status, detail) => L.push(`  ${MARK[status]}  ${name.padEnd(22)}${C.dim}${detail}${C.off}`);
  const st = (bad, ran) => bad ? 'bad' : ran ? 'ok' : 'skip';
  line('מקור',        stats.loaded === periods.length ? 'ok' : stats.loaded ? 'warn' : 'bad',
                                                        `${stats.loaded}/${periods.length} טאבים נטענו · ${stats.schools} בתי ספר`);
  line('מבנה',        st(stats.byCode.structure, stats.rows), `${stats.rows} שורות נתונים נסרקו · ${stats.byCode.structure || 0} ממצאים`);
  line('הצלבה עירונית', st(stats.byCode.oracle, stats.oracle.compared), `${stats.oracle.matched}/${stats.oracle.compared} תואמים מול «סה״כ עיר»`);
  line('פרסר הדשבורד', st(stats.byCode.parser, stats.parity.cells), `${stats.parity.cells.toLocaleString('he-IL')} תאים הושוו · ${stats.parity.diffs} פערים`);
  line('חישוב',       st(stats.byCode.metric, stats.metrics.n),  `${stats.metrics.n} מדדים מול חישוב עצמאי`);
  line('רינדור',      st(stats.byCode.render, stats.render.n),   `${stats.render.n} מספרים על המסך נבדקו`);
  line('היגיון',      warns.length ? 'warn' : stats.rows ? 'ok' : 'skip',
                                                        warns.length ? `${warns.length} חשודים לעין אנושית` : 'ללא חריגות');
  L.push('');

  const show = (list, color, title) => {
    if (!list.length) return;
    L.push(`${color}${title} (${list.length})${C.off}`);
    const cap = opt.verbose ? list.length : Math.min(list.length, 8);
    list.slice(0, cap).forEach((f, i) => {
      const w = f.where || {};
      const tag = [w.period, w.line ? 'שורה ' + w.line : null].filter(Boolean).join(' · ');
      L.push(`  ${String(i + 1).padStart(2)}. ${f.message}`);
      if (tag) L.push(`      ${C.dim}${tag}${C.off}`);
      if (f.why && opt.verbose) L.push(`      ${C.dim}${f.why}${C.off}`);
    });
    if (list.length > cap) L.push(`  ${C.dim}… ועוד ${list.length - cap}. הרץ עם -v לרשימה המלאה.${C.off}`);
    L.push('');
  };
  show(blocked, C.yel, 'חסימות — טאבים שלא נטענו, ולכן לא נבדקו');
  show(errs,    C.red, 'שגיאות — הנתונים שעל המסך אינם מה שבגיליון');
  show(warns,   C.yel, 'חשודים — צריך עין אנושית, לא תיקון קוד');
  if (opt.verbose) show(infos, C.dim, 'שינויים מאז קו הבסיס');
  else if (infos.length) L.push(`  ${C.dim}${infos.length} שינויים מאז קו הבסיס (-v להצגה)${C.off}`, '');

  if (state.sample?.length){
    L.push(`${C.dim}מדגם — ${state.sample.length} תאים אקראיים, seed ${state.seed}${C.off}`);
    for (const s of state.sample)
      L.push(`  ${s.ok ? C.grn + '✔' + C.off : C.red + '✘' + C.off}  ${s.period} · ${s.school} · ${s.grade}׳ · ${s.row}` +
             `  ${C.dim}שורה ${s.line}:${C.off} גיליון ${fmt(s.sheet)} → דשבורד ${fmt(s.dash)}`);
    L.push('');
  }

  // "לא הצלחתי לבדוק" אינו "מצאתי בעיה". טאב שלא נטען חוסם את הבדיקה,
  // והכרזה על "לא מהימן" במקרה כזה היא בדיוק סוג ההנחה שהכלי בא למנוע.
  const verdict = blocked.length === periods.length
    ? `${C.yel}${C.bold}לא ניתן לבדוק${C.off} — אף טאב לא נטען. ${C.dim}אין כאן קביעה על הנתונים.${C.off}`
    : errs.length
      ? `${C.red}${C.bold}לא מהימן${C.off} — ${errs.length} פערים בין הגיליון למסך`
      : blocked.length
        ? `${C.yel}${C.bold}בדיקה חלקית${C.off} — ${periods.length - blocked.length} מתוך ${periods.length} תקופות נבדקו ונמצאו תקינות`
        : warns.length
          ? `${C.grn}${C.bold}הנתונים מהימנים${C.off} — כל מספר שנבדק זהה לגיליון · ${C.yel}${warns.length} אזהרות היגיון${C.off}`
          : `${C.grn}${C.bold}הנתונים מהימנים${C.off} — כל מספר שנבדק זהה לגיליון, ללא חריגות`;
  L.push('  ' + verdict);
  L.push('');
  return L.join('\n');
}

// ════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════
async function main(){
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help){ console.log(HELP); return 0; }
  const t0 = Date.now();
  const seed = opt.seed ?? (Date.now() & 0xffff);

  const dash = readDashboard(opt.dashboard);
  const findings = [];

  // אוצר המילים של הדשבורד מול המפרט
  const dashKeys = new Set(Object.keys(dash.ROWKEY));
  for (const k of Object.keys(ROW_SPEC)) if (!dashKeys.has(k))
    findings.push(F('error', 'rowkey_drift', `שורת התקן «${ROW_SPEC[k].label}» אינה ב-ROWKEY של הדשבורד`, {},
      'הדשבורד לא יזהה את השורה הזו ויזרוק אותה בשקט.'));

  let entries = Object.entries(dash.GID_MAP);
  if (opt.gid) entries = entries.filter(([, g]) => g === opt.gid);
  if (!entries.length){ console.error('אין טאבים לבדיקה'); return 2; }

  // ── טעינה ──
  const csvByGid = {};
  const periods = [];
  for (const [name, gid] of entries){
    const p = { name, gid, label:name, ...periodMeta(name) };
    try {
      const text = opt.fromDir ? readCsvDir(opt.fromDir, gid) : await fetchCsv(dash.PUB, gid, opt.timeout);
      if (text == null) throw new Error('לא נמצא קובץ CSV עבור gid ' + gid);
      csvByGid[gid] = text;
      p.rows = csvParse(text);
    } catch (e){
      findings.push(F('error', 'load_failed', `«${name}» לא נטען: ${e.message}`, { period:name },
        'טאב שלא נטען פשוט נעלם מבורר התקופות — בלי הודעה למשתמש.'));
    }
    periods.push(p);
  }

  // ── L0 מול L1 — המקור מול המפורסם ──
  if (opt.sourceDir){
    for (const p of periods){
      const src = readCsvDir(opt.sourceDir, p.gid);
      if (src == null){
        findings.push(F('warn', 'no_source', `«${p.label}» — אין קובץ מקור להשוואה`, { period:p.label }));
        continue;
      }
      const a = csvParse(src), b = p.rows || [];
      let diffs = 0;
      const rows = Math.max(a.length, b.length);
      for (let i = 0; i < rows; i++){
        const ra = a[i] || [], rb = b[i] || [];
        for (let j = 0; j < Math.max(ra.length, rb.length); j++)
          if (clean(ra[j]) !== clean(rb[j])) diffs++;
      }
      if (diffs) findings.push(F('error', 'publish_stale',
        `«${p.label}» — ${diffs} תאים שונים בין גיליון המקור ל-CSV המפורסם`, { period:p.label },
        'הפרסום לרשת אינו מסונכרן עם הגיליון. הדשבורד מציג את הגרסה המפורסמת, כלומר נתונים ישנים.'));
    }
  }

  // ── L2 — מודל וחישוב עצמאיים ──
  let rowsScanned = 0, schoolsTotal = 0;
  const oracle = { compared:0, matched:0 };
  for (const p of periods){
    if (!p.rows) continue;
    const ctx = { period:p.label };
    p.model = buildModel(p.rows, findings, ctx);
    rowsScanned += p.model.dataLines;
    schoolsTotal = Math.max(schoolsTotal, p.model.schools.size);
    p.agg = checkStructure(p.model, findings, ctx);
    const o = checkCityOracle(p.model, findings, ctx);
    oracle.compared += o.compared; oracle.matched += o.matched;
  }

  checkPlausibility(periods, findings, opt);

  // ── L3/L4 — הרצת הדשבורד עצמו ──
  const parity = { cells:0, diffs:0 };
  const metrics = { n:0, bad:0 };
  const render  = { n:0, bad:0 };
  const dashOut = await runDashboard(dash, csvByGid, findings);
  if (dashOut){
    for (const p of periods){
      if (!p.model) continue;
      // התאמה לפי שם הטאב עצמו — ALLDATA שומר אותו ב-sheetName
      const key = Object.keys(dashOut.byKey).find(k => norm(dashOut.byKey[k].sheetName) === norm(p.name));
      const D = key ? dashOut.byKey[key] : null;
      if (!D){
        findings.push(F('error', 'period_missing',
          `«${p.label}» נטען כאן אך אינו בבורר התקופות של הדשבורד`, { period:p.label },
          'המשתמש לא יוכל לבחור את התקופה הזו בכלל.'));
        continue;
      }
      p.dash = D;
      const ctx = { period:p.label };
      const c = compareModels(p.model, D, findings, ctx);
      parity.cells += c.cells; parity.diffs += c.diffs;
      const m = compareMetrics(p.agg, D, p.model.schools.size, findings, ctx);
      metrics.n += m.n; metrics.bad += m.bad;
      const r = checkRendered(p.agg, D, findings, ctx);
      render.n += r.n; render.bad += r.bad;
    }
  }

  // ── קו בסיס ──
  const snap = snapshot(periods);
  if (opt.writeBaseline){
    fs.writeFileSync(BASELINE, JSON.stringify({ build:dash.build, at:new Date().toISOString(), snapshot:snap }, null, 2) + '\n');
  } else if (opt.baseline){
    diffBaseline(snap, findings);
  }

  const byCode = {};
  for (const f of findings){
    if (f.severity !== 'error') continue;
    const g = ['non_numeric','negative','gender_sum','exceeds_total','girls_exceed','tech_below_parts',
               'orphan_values','duplicate_row','row_vocabulary','rowkey_drift','no_schools'].includes(f.code) ? 'structure'
      : f.code === 'oracle_mismatch' ? 'oracle'
      : ['parser_diff','school_dropped','school_invented','grade_presence'].includes(f.code) ? 'parser'
      : ['metric_diff'].includes(f.code) ? 'metric'
      : ['render_diff','render_throw'].includes(f.code) ? 'render' : 'other';
    byCode[g] = (byCode[g] || 0) + 1;
  }

  const state = {
    findings, periods, dash, seed, elapsed: Date.now() - t0,
    sample: opt.sample > 0 ? traceSample(periods, opt.sample, seed) : [],
    stats: { loaded: periods.filter(p => p.rows).length, rows: rowsScanned, schools: schoolsTotal,
             oracle, parity, metrics, render, byCode },
  };

  const blocked = findings.filter(f => f.code === 'load_failed').length;
  const real = findings.filter(f => f.severity === 'error' && f.code !== 'load_failed').length;
  const verdict = blocked === periods.length ? 'blocked'
                : real ? 'fail'
                : blocked ? 'partial'
                : findings.some(f => f.severity === 'warn') ? 'warn' : 'pass';

  if (opt.json){
    console.log(JSON.stringify({
      build: dash.build, seed, elapsed: state.elapsed, verdict,
      stats: state.stats, snapshot: snap, sample: state.sample, findings,
    }, null, 2));
  } else {
    console.log(report(state, opt));
  }

  return verdict === 'fail' ? 1 : verdict === 'blocked' ? 2 : 0;
}

// process.exit() קוטע כתיבה תלויה ל-pipe. קובעים קוד יציאה ונותנים
// ל-Node לסיים לבד אחרי שה-stdout התרוקן.
main().then(c => { process.exitCode = c; })
      .catch(e => { console.error(e); process.exitCode = 3; });
