// רענון הנתונים: להריץ בקונסול (F12) בעמוד https://shkifut.education.gov.il/home
// הפלט: שלושה בלוקים להדבקה בתוך index.html במקום RAS_TXT, NAT_TXT ו־EXTRA של העיר הממוקדת.
(async () => {
  const FOCUS = 66001; // סמל הרשות הממוקדת (חולון)
  const g = async u => (await fetch(u)).json();
  const C5 = ['ACHUZ_ZAKAIM','ACHUZ_ZAKAIM_MITZTYEN','ACHUZ_ZAKAIM_BG_TECH_ANG5','ACHUZ_ANGLIT_5YL','ACHUZ_MATEM_5YL'];
  const ALL = C5.concat(['ACHUZ_ANGLIT_4YL','ACHUZ_MATEM_4YL','ACHUZ_ZAK_TECH_KLALI','ACHUZ_ZAK_TECH_33','ACHUZ_ZAK_TECH_21_31_32_33']);
  const lists = await g('/api/data/lists');
  const rashuyot = Object.values(lists.infoLists).filter(x => x.Mode == 2);
  const lines = [], focus = {};
  const one = async r => {
    const [h, k] = await Promise.all([
      g('/api/data/rashutHistory/?semelRashut=' + r.Semel),
      g('/api/data/rashut/?semelRashut=' + r.Semel + '&year=2025')]);
    const ak = h.rashutAkavish || [], kl = k.rashutKlali || {};
    const v = (y, c, id) => ak.find(a => a.year == y && a.Class_Id == c && a.Var_id == id)?.ACHUZ_RASHUTI;
    if (v(2025, 12, 'ACHUZ_ZAKAIM') == null) return;
    const vals = [];
    for (const y of [2022, 2023, 2024, 2025]) for (const id of C5) vals.push(v(y, 12, id) ?? '');
    lines.push([r.Semel, r.Shem, kl.MATSAV_SOTSYOEKONOMI, kl.CODE_MACHOZ_GEOGRAFI, kl.TALMIDIM, kl.TALMIDIM_12, vals.join(',')].join('|'));
    if (r.Semel == FOCUS) for (const c of [12, 120]) {
      const o = {};
      for (let y = c == 12 ? 2014 : 2022; y <= 2025; y++) o[y] = ALL.map(id => v(y, c, id) ?? '').join(',');
      focus[c] = Object.keys(o).map(y => y + ':' + o[y]).join('\n');
    }
  };
  for (let i = 0; i < rashuyot.length; i += 12) await Promise.all(rashuyot.slice(i, i + 12).map(one));
  const nat = (await g('/api/data/national/?year=2025')).nationalHistory.arziAkavish.filter(a => a.Class_Id == 12);
  const N = {};
  nat.forEach(a => (N[a.year] ??= {})[a.Var_id] = a.ACHUZ_ARTZI);
  const natTxt = Object.keys(N).map(y => y + ':' + ALL.map(id => N[y][id] ?? '').join(',')).join('\n');
  console.log('=== RAS_TXT ===\n' + lines.join('\n'));
  console.log('=== NAT_TXT ===\n' + natTxt);
  console.log('=== EXTRA all (עיר ' + FOCUS + ') ===\n' + focus[12]);
  console.log('=== EXTRA noSE ===\n' + focus[120]);
})();
