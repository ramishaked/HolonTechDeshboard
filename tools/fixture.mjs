/* ── נתוני בדיקה סינתטיים ─────────────────────────────────────────
   מקור אמת אחד, שני מסלולים ממנו:
     csvFor(gid)      → CSV במבנה §2 המדויק, כפי שהגיליון מגיש אותו
     expectedFor(gid) → הערכים שאמורים להתקבל, מסוכמים ישירות מהמפרט

   הדשבורד מגיע לתשובה דרך csvParse → parseSheet → cityPct.
   הבדיקה מגיעה אליה דרך סכימה פשוטה. שני מסלולים בלתי תלויים לאותו
   מספר — בדיוק העיקרון של §3.1 ("חישוב עצמאי"), במיניאטורה.

   ⚠ אלה אינם נתוני חולון ואינם מתיימרים להיות. ההצלבה מול הגיליון
   האמיתי (§8) נעשית בדפדפן מול נתונים חיים, ואינה חלק מהבדיקה הזו.
─────────────────────────────────────────────────────────────────── */

export const ALL_GRADES = ['ז', 'ח', 'ט', 'י', 'יא', 'יב'];
export const HIGH = ['י', 'יא', 'יב'];

// שורה בגיליון → מפתח פנימי. הסדר הוא הסדר שבו הן ייכתבו ל-CSV.
const ROWS = [
  ['כמות תלמידים', 'total'],
  ['פיזיקה 5 יח׳', 'ph'],
  ['מדעי המחשב 5 יח׳', 'cs'],
  ['מתמטיקה 3יח׳', 'ma3'],
  ['מתמטיקה 4 יח׳', 'ma4'],
  ['מתמטיקה 5 יח׳', 'ma5'],
  ['אנגלית 5 יח׳', 'en5'],
  ['עתיד טק', 'ft'],
  ['זכאות למדד טק', 'ht'],
];

// כל ערך הוא [בנים, בנות]. חסר = תא ריק בגיליון.
// ארבעה בתי ספר שנבחרו כדי לכסות את מקרי הקצה של §3.5 ושל amat:
//   אלפא  — ז׳–יב׳ מלא
//   בטא   — חט״ע, י׳–יב׳ בלבד
//   גמא   — חטיבה, ז׳–ט׳ בלבד + פיזיקה=מדמ״ח=זכאות בט׳ (amat=1)
//   דלתא  — י׳+יא׳ בלבד (partial: נכלל במדד העירוני, מחוץ לדירוג ולנשירה)
const BASE = [
  {
    name: 'תיכון אלפא',
    grades: {
      'ז':  { total: [100, 100] },
      'ח':  { total: [100, 100] },
      'ט':  { total: [100, 100], ft: [30, 30] },
      'י':  { total: [250, 250], ht: [60, 40], cs: [40, 20], ph: [30, 20],
              ma5: [90, 60], ma4: [50, 50], ma3: [60, 40], en5: [100, 100] },
      'יא': { total: [200, 200], ht: [50, 30], cs: [30, 20], ph: [25, 15],
              ma5: [70, 50], ma4: [40, 40], ma3: [45, 35], en5: [85, 85] },
      'יב': { total: [150, 150], ht: [30, 15], cs: [20, 10], ph: [15, 10],
              ma5: [60, 40], ma4: [30, 30], ma3: [30, 30], en5: [70, 70] },
    },
  },
  {
    name: 'תיכון בטא',
    grades: {
      'י':  { total: [150, 150], ht: [30, 30], cs: [20, 10], ph: [15, 15],
              ma5: [50, 50], ma4: [30, 30], ma3: [40, 40], en5: [60, 60] },
      'יא': { total: [125, 125], ht: [25, 25], cs: [15, 10], ph: [12, 13],
              ma5: [40, 40], ma4: [25, 25], ma3: [35, 35], en5: [50, 50] },
      'יב': { total: [100, 100], ht: [15, 15], cs: [10,  5], ph: [8,   7],
              ma5: [35, 35], ma4: [20, 20], ma3: [25, 25], en5: [40, 40] },
    },
  },
  {
    name: 'חטיבת גמא',
    grades: {
      'ז': { total: [75, 75] },
      'ח': { total: [75, 75] },
      // פיזיקה = מדמ״ח = זכאות → amat=1 (רישום קבוצת עמ״ט, לא בחירת מקצוע)
      'ט': { total: [50, 50], ht: [15, 10], cs: [15, 10], ph: [15, 10], ft: [20, 20] },
    },
  },
  {
    name: 'תיכון דלתא',
    grades: {
      'י':  { total: [100, 100], ht: [20, 20], cs: [12, 8], ph: [10, 10],
              ma5: [30, 30], ma4: [25, 25], ma3: [30, 30], en5: [40, 40] },
      'יא': { total: [90, 90], ht: [15, 15], cs: [10, 5], ph: [8, 7],
              ma5: [25, 25], ma4: [20, 20], ma3: [25, 25], en5: [35, 35] },
    },
  },
];

const MATZEVET = { 'ז': 400, 'ח': 400, 'ט': 350, 'י': 1050, 'יא': 870, 'יב': 520 };

// ── התקופות ─────────────────────────────────────────────────────
// ה-GID-ים זהים ל-GID_MAP שב-index.html, אחרת הדף לא ימצא את הפיקסצ׳ר.
// mul  — מקדם על כל המונים (לא על 'כמות תלמידים'), כדי שההשוואה
//        השנתית תראה שינוי אמיתי ולא שתי דגימות זהות.
// noFT — 'עתיד טק' לא הוזן בתקופה הזו. משחזר את המצב האמיתי ב-§8
//        (השורה קיימת בגיליון וריקה), ובודק ש-— מוצג ולא 0%.
export const PERIODS = [
  { gid: '392061415',  name: 'תשפ"ה (סוף שנה)',   mul: 1.00 },
  { gid: '1592440184', name: 'תשפ"ו (תחילת שנה)', mul: 1.20 },
  { gid: '543820427',  name: 'תשפ"ו (2)',         mul: 1.10, noFT: true },
];
export const DEFAULT_GID = PERIODS[PERIODS.length - 1].gid;   // הדף נפתח על האחרונה

function schoolsFor(gid) {
  const p = PERIODS.find(x => x.gid === gid);
  if (!p) throw new Error('אין פיקסצ׳ר ל-gid ' + gid);
  const scale = ([b, g]) => [Math.round(b * p.mul), Math.round(g * p.mul)];
  return BASE.map(s => ({
    name: s.name,
    grades: Object.fromEntries(Object.entries(s.grades).map(([g, vals]) => {
      const out = {};
      for (const [k, v] of Object.entries(vals)) {
        if (k === 'ft' && p.noFT) continue;         // השורה תיכתב ריקה
        out[k] = k === 'total' ? v : scale(v);
      }
      return [g, out];
    })),
  }));
}

// ── מסלול א׳: סריאליזציה ל-CSV לפי §2 ───────────────────────────
// base(שכבה) = 2 + i*6 ; בתוך הבלוק: 0=בנים 1=בנות 2=סה״כ 3..5=אחוזים
const NCOL = 2 + ALL_GRADES.length * 6;
const q = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));

function blankRow() { return Array(NCOL).fill(''); }

function dataRow(school, label, key, schools) {
  const r = blankRow();
  r[0] = school.name;
  r[1] = label;
  ALL_GRADES.forEach((g, i) => {
    const vals = school.grades[g];
    if (!vals || !vals[key]) return;
    const [b, gi] = vals[key];
    const tot = b + gi;
    const denom = vals.total ? vals.total[0] + vals.total[1] : 0;
    const base = 2 + i * 6;
    r[base] = b;
    r[base + 1] = gi;
    r[base + 2] = tot;
    if (denom) {
      r[base + 3] = (b / denom * 100).toFixed(1);
      r[base + 4] = (gi / denom * 100).toFixed(1);
      r[base + 5] = (tot / denom * 100).toFixed(1);
    }
  });
  return r;
}

export function csvFor(gid) {
  const schools = schoolsFor(gid);
  const rows = [];

  // כותרת — parseSheet מדלג עליה לפי 'בית ספר'/'מקצועות' בעמודות 0–1
  const head = blankRow();
  head[0] = 'בית ספר';
  head[1] = 'מקצועות';
  ALL_GRADES.forEach((g, i) => { head[2 + i * 6 + 2] = g; });
  rows.push(head);

  for (const s of schools) {
    for (const [label, key] of ROWS) rows.push(dataRow(s, label, key, schools));
    // שורה שהפרסר אינו מכיר — חייבת להידלג בשלום (ראה "מה בתור" ב-CLAUDE.md)
    const unknown = blankRow();
    unknown[0] = s.name;
    unknown[1] = 'בוגרי עתיד טק';
    unknown[2 + 3 * 6 + 2] = 7;
    rows.push(unknown);
    rows.push(blankRow());
  }

  // מצבת — מספר ייחוס, לא מכנה (§3.2)
  const mz = blankRow();
  mz[0] = 'מצבת';
  mz[1] = 'כמות תלמידים';
  ALL_GRADES.forEach((g, i) => { if (MATZEVET[g]) mz[2 + i * 6 + 2] = MATZEVET[g]; });
  rows.push(mz);

  // סה"כ עיר — מספרים שגויים בכוונה. אם הם יופיעו במסך, §3.1 נשבר.
  for (const [label] of ROWS) {
    const r = blankRow();
    r[0] = 'סה"כ עיר';
    r[1] = label;
    ALL_GRADES.forEach((g, i) => { r[2 + i * 6 + 2] = 99999; });
    rows.push(r);
  }

  return rows.map(r => r.map(q).join(',')).join('\n');
}

// ── מסלול ב׳: הערכים הצפויים, מסוכמים מהמפרט ─────────────────────
const sum = (schools, grade, key) => schools.reduce((acc, s) => {
  const v = s.grades[grade] && s.grades[grade][key];
  return acc + (v ? v[0] + v[1] : 0);
}, 0);

export function expectedFor(gid) {
  const schools = schoolsFor(gid);
  const pct = g => {
    const t = sum(schools, g, 'total');
    return t ? sum(schools, g, 'ht') / t * 100 : 0;
  };
  const p10 = pct('י'), p11 = pct('יא'), p12 = pct('יב');

  // נשירה עירונית — נגזרת מהמדדים העירוניים (כל בתי הספר), כמו בדשבורד
  const drop = p10 ? (p10 - p12) / p10 * 100 : 0;

  return {
    schools: schools.length,
    techTotal: HIGH.reduce((a, g) => a + sum(schools, g, 'ht'), 0),
    p10, p11, p12, drop,
    // מספר הפוטנציאל של תצוגה 8: מתמטיקה 5 פחות זכאות, בשכבת יב׳
    potential: sum(schools, 'יב', 'ma5') - sum(schools, 'יב', 'ht'),
  };
}
