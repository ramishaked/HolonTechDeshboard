/* ── API מדומה של shkifut.education.gov.il, במבנה המדויק שבמדריך הגישה.
   משמש את bigpicture-check.mjs ואת refresh-data.mjs --mock. ──────────── */
const CITIES = [
  [66001, 'חולון', 1], [62000, 'בת ים', 1], [83006, 'ראשון לציון', 2], [84004, 'רחובות', 2], [86009, 'רמת גן', 1],
  [79004, 'פתח תקווה', 2], [40006, 'חיפה', 3], [72009, 'נס ציונה', 2], [50000, 'תל אביב - יפו', 1], [70001, 'אשדוד', 4],
  [90009, 'באר שבע', 4], [74001, 'נתניה', 2], [64000, 'הרצליה', 1], [69002, 'כפר סבא', 2], [63000, 'גבעתיים', 1],
  [87000, 'רעננה', 2], [26400, 'ראש העין', 2], [26600, 'יבנה', 2], [24000, 'אור יהודה', 1], [65000, 'חדרה', 3],
  [68007, 'קרית אתא', 3], [71000, 'אשקלון', 4], [30001, 'ירושלים', 5], [61000, 'בני ברק', 1], [97000, 'הוד השרון', 2],
  [26200, 'קריית אונו', 1], [94000, 'יהוד-מונוסון', 2], [85000, 'רמלה', 2], [70000, 'לוד', 2], [11111, 'מועצה קטנה', 2],
];
const DIST = { 1: 'תל אביב', 2: 'מרכז', 3: 'חיפה', 4: 'דרום', 5: 'ירושלים' };
const MACHOZ_CODE = { 1: 5, 2: 4, 3: 3, 4: 6, 5: 1 };      // לקודים האמיתיים של האתר
const VARS = ['ACHUZ_ZAKAIM', 'ACHUZ_ZAKAIM_MITZTYEN', 'ACHUZ_ZAKAIM_BG_TECH_ANG5', 'ACHUZ_ANGLIT_5YL', 'ACHUZ_ANGLIT_4YL',
  'ACHUZ_MATEM_5YL', 'ACHUZ_MATEM_4YL', 'ACHUZ_ZAK_TECH_KLALI', 'ACHUZ_ZAK_TECH_33', 'ACHUZ_ZAK_TECH_21_31_32_33'];
const HEB = { ACHUZ_ZAKAIM: 'זכאות לבגרות', ACHUZ_ZAKAIM_MITZTYEN: 'בגרות מצטיינת', ACHUZ_ZAKAIM_BG_TECH_ANG5: 'בגרות טק' };
const BASE = { ACHUZ_ZAKAIM: 78, ACHUZ_ZAKAIM_MITZTYEN: 14, ACHUZ_ZAKAIM_BG_TECH_ANG5: 12, ACHUZ_ANGLIT_5YL: 50, ACHUZ_ANGLIT_4YL: 17,
  ACHUZ_MATEM_5YL: 18, ACHUZ_MATEM_4YL: 21, ACHUZ_ZAK_TECH_KLALI: 30, ACHUZ_ZAK_TECH_33: 6, ACHUZ_ZAK_TECH_21_31_32_33: 9 };
// חולון, כפי שהיא מופיעה באתר (מדריך הגישה + הטיוטה לתקשורת): תשפ״ה / תשפ״ד
const HOLON = { 2025: { ACHUZ_ZAKAIM: 82.1, ACHUZ_ZAKAIM_MITZTYEN: 11.6, ACHUZ_ZAKAIM_BG_TECH_ANG5: 14.6, ACHUZ_ANGLIT_5YL: 58.2, ACHUZ_MATEM_5YL: 21.9 },
  2024: { ACHUZ_ZAKAIM: 83.8, ACHUZ_ZAKAIM_MITZTYEN: 9.4, ACHUZ_ZAKAIM_BG_TECH_ANG5: 13.7, ACHUZ_ANGLIT_5YL: 55.3, ACHUZ_MATEM_5YL: 20.7 } };
const NAT = { 2025: { ACHUZ_ZAKAIM: 77.9, ACHUZ_ZAKAIM_MITZTYEN: 14.4, ACHUZ_ZAKAIM_BG_TECH_ANG5: 11.6, ACHUZ_ANGLIT_5YL: 48.7, ACHUZ_MATEM_5YL: 17.1 } };
const rnd = seed => { let x = seed % 2147483647; return () => (x = x * 16807 % 2147483647) / 2147483647; };
const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

function history(semel) {
  const r = rnd(semel), rows = [];
  for (const v of VARS) for (const y of YEARS) for (const cls of [12, 120]) {
    let x = Math.max(0.5, BASE[v] + (r() - .5) * 16 + (y - 2020) * .3);
    if (semel === 66001 && HOLON[y]?.[v] != null) x = HOLON[y][v] + (cls === 120 ? 3 : 0);
    if (semel === 11111 && y < 2024) continue;                 // רשות בלי היסטוריה: "חדש"
    rows.push({ year: y, Class_Id: cls, Entity_id: semel, Var_id: v, Var_Id_Heb: HEB[v] || v, ACHUZ_RASHUTI: +x.toFixed(1) });
  }
  return { rashutAkavish: rows };
}
export function api(url) {
  const u = new URL(url, 'https://shkifut.education.gov.il');
  const q = u.searchParams;
  if (u.pathname === '/api/data/lists') {
    const items = [
      ...CITIES.map(([s, n]) => ({ Semel: s, Snif: 0, Shem: n, Address: '', Mode: 2, Date: '' })),
      ...Object.entries(DIST).map(([s, n]) => ({ Semel: +s, Snif: 0, Shem: n, Address: '', Mode: 1, Date: '' })),
      { Semel: 123456, Snif: 0, Shem: 'בית ספר לדוגמה', Address: '', Mode: 3, Date: '' },
    ];
    return { infoLists: Object.fromEntries(items.map((x, i) => [i, x])) };
  }
  if (u.pathname === '/api/data/national/') {
    const rows = [];
    for (const v of VARS) for (const y of YEARS) rows.push({ year: y, Class_Id: 12, Var_id: v, Var_Id_Heb: HEB[v] || v,
      ACHUZ_ARTZI: NAT[y]?.[v] ?? +(BASE[v] + (y - 2020) * .4).toFixed(1) });
    // שנת 2026 עוד לא פורסמה: שאילתה עליה מחזירה היסטוריה עד 2025
    return { nationalHistory: { arziAkavish: rows } };
  }
  if (u.pathname === '/api/data/rashutHistory/') return history(+q.get('semelRashut'));
  if (u.pathname === '/api/data/rashut/') {
    const s = +q.get('semelRashut'), c = CITIES.find(x => x[0] === s), r = rnd(s + 7);
    const n12 = s === 66001 ? 2400 : s === 11111 ? 60 : Math.round(500 + r() * 4000);
    return { rashutKlali: [{ SEMEL_RASHUT: s, TALMIDIM_12: n12, TALMIDIM_TECHNOLOGI: s === 66001 ? 47.7 : +(r() * 60).toFixed(1),
      MDD_SAL_ISHI: +(r() * 5).toFixed(1), TALMIDIM: n12 * 4, CODE_MACHOZ_GEOGRAFI: MACHOZ_CODE[c[2]], MATSAV_SOTSYOEKONOMI: s === 66001 ? 7 : 5 + (s % 4) }], shichvot: [{ a: 1 }, { a: 2 }] };
  }
  return null;
}

