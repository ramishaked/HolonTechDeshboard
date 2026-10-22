#!/usr/bin/env node
/* מחיל קובץ rashutEduPic שנשלף על BigPicture/data.json, בלי רשת.
   שימוש:  node tools/apply-edupic.mjs FILE [--dry]   (FILE: קובץ { rashuyot: { סמל: groups } } שנשלף מ-/api/data/rashutEduPic/)
   הלוגיקה ב-tools/edupic.mjs (משותפת עם refresh-data.mjs). */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeEduPic } from './edupic.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), dry = args.includes('--dry');
const arg = args.find(a => !a.startsWith('--'));
if (!arg) { console.error('חסר קובץ קלט. שימוש: node tools/apply-edupic.mjs FILE [--dry]'); process.exit(1); }
const src = path.resolve(arg);
const OUT = path.join(ROOT, 'BigPicture', 'data.json');
let raw = fs.readFileSync(src); if (src.endsWith('.gz')) raw = zlib.gunzipSync(raw);
const pic = JSON.parse(raw), data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const st = mergeEduPic(data, pic.rashuyot, console.log);
for (const x of st.changed.sort((a, b) => Math.abs(b.now - b.old) - Math.abs(a.now - a.old)).slice(0, 15)) console.log(`  ${x.n} ${x.v.replace('ACHUZ_', '')} כיתה ${x.cls}: ${x.old} הפך ל ${x.now}`);
if (dry) { console.log('--dry: לא נכתב'); process.exit(0); }
delete data.overrides;
data.edupic = { source: '/api/data/rashutEduPic/', year: data.year, appliedAt: new Date().toISOString().slice(0, 10), changed: st.changed.length, filled: st.filled.length };
fs.writeFileSync(OUT, JSON.stringify(data));
console.log('✓ נכתב ' + path.relative(ROOT, OUT));
