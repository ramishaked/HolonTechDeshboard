/* ── מיזוג rashutEduPic לתוך data.json ────────────────────────────────
   העמוד הרשמי של שקיפות בחינוך (/city/<סמל>/educationPicture) קורא את נתוני
   השנה העדכנית מ-/api/data/rashutEduPic/?semelRashut=&year=, ולא מ-rashutHistory.
   ל-2014 עד 2024 שתי הנקודות זהות; ב-2025 rashutHistory החזיר נתון ישן
   (חולון בגרות טק 14.6 מול 14.8 בעמוד; נמדד ב-22.10.2026, 74 ערכים ב-38 רשויות).
   לכן ערכי השנה העדכנית של מדדי הליבה נלקחים מ-rashutEduPic, מעוגלים לעשירית כמו בעמוד. */
export const CORE = ['ACHUZ_ZAKAIM', 'ACHUZ_ZAKAIM_MITZTYEN', 'ACHUZ_ZAKAIM_BG_TECH_ANG5', 'ACHUZ_ANGLIT_5YL', 'ACHUZ_MATEM_5YL'];
const r1 = v => Math.round((v + 1e-9) * 10) / 10;

// eduPic: { "<semel>": [ {Id:5, Classes:[{Id:12, Indexes:[{Id, Year, Value}]}]} ] }
export function mergeEduPic(data, eduPic, log = () => {}) {
  const yi = data.years.indexOf(data.year);
  if (yi < 0) throw new Error('שנת הנתונים לא נמצאת ב-years');
  const byS = new Map(data.rashuyot.map(r => [r.s, r]));
  const st = { compared: 0, changed: [], filled: [], noRashut: 0, unchanged: 0 };
  for (const [s, groups] of Object.entries(eduPic)) {
    const r = byS.get(+s);
    if (!r) { st.noRashut++; continue; }
    for (const gr of groups || []) for (const cl of gr.Classes || []) {
      const cls = String(cl.Id); if (cls !== '12' && cls !== '120') continue;
      for (const ix of cl.Indexes || []) {
        if (!CORE.includes(ix.Id) || +ix.Year !== data.year || ix.Value == null) continue;
        const v = r1(+ix.Value), h = (r.h[cls] = r.h[cls] || {});
        const arr = (h[ix.Id] = h[ix.Id] || data.years.map(() => null));
        const old = arr[yi]; st.compared++;
        if (old == null) { st.filled.push({ n: r.n, v: ix.Id, cls, now: v }); arr[yi] = v; }
        else if (Math.abs(old - v) > 0.049) { st.changed.push({ n: r.n, v: ix.Id, cls, old, now: v }); arr[yi] = v; }
        else st.unchanged++;
      }
    }
  }
  log(`rashutEduPic ${data.year}: נבדקו ${st.compared} ערכים, ${st.changed.length} תוקנו, ${st.filled.length} הושלמו, ${st.unchanged} זהים` + (st.noRashut ? `, ${st.noRashut} רשויות שאינן בקובץ` : ''));
  return st;
}
