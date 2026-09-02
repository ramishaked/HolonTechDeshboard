// שאלה על נתוני הדשבורד (תצוגה 13). נקודת קצה אחת: POST /api/ask
// { question, payload } → { answer, usage }.
//
// הדף ב-GitHub Pages בונה את חבילת המדדים בעצמו ושולח אותה לכאן עם
// השאלה. התפקיד של הפונקציה: להחזיק את מפתח ה-API מחוץ לדף, לבדוק מי
// שולח, ולהעביר ל-Claude. אין כאן חישוב, אין אחסון ואין לוג של שאלות.
//
// משתני סביבה (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   חובה.
//   ALLOWED_ORIGIN      רשות. ברירת מחדל: https://ramishaked.github.io
//   ASK_MODEL           רשות. ברירת מחדל: claude-opus-5

import Anthropic from '@anthropic-ai/sdk';

const ORIGIN   = process.env.ALLOWED_ORIGIN || 'https://ramishaked.github.io';
const MODEL    = process.env.ASK_MODEL || 'claude-opus-5';
const MAX_BODY = 400 * 1024;     // החבילה כ-60–120KB; מעבר לזה אינו הדף שלנו
const MAX_Q    = 500;            // תווים בשאלה
const RATE     = { n: 20, ms: 10 * 60 * 1000 };   // לכל IP, per מופע (best effort)

// מגבלת קצב בזיכרון המופע. Serverless יכול להריץ כמה מופעים במקביל,
// ולכן זו הגנה חלקית בלבד. ההגנה הקובעת היא מגבלת ההוצאה בקונסול של
// Anthropic (ראה README).
const hits = new Map();
function limited(ip){
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE.ms);
  arr.push(now); hits.set(ip, arr);
  return arr.length > RATE.n;
}

// ההגדרות שהמודל חייב לדעת כדי לא לטעות במכנה. תואם למפרט (§3) ול-CLAUDE.md.
const SYSTEM = `אתה עונה על שאלות של מנהלי חינוך על נתוני "מדד בגרות-טק" של העיר חולון.
המספרים נמצאים בחבילת JSON שמצורפת אחרי ההגדרות. ענה בעברית, קצר וענייני, לקהל של מנהלי בתי ספר ומנהלי אגף.

כללי ברזל:
1. השתמש אך ורק במספרים שבחבילה. אל תחשב הערכות ואל תשלים נתון חסר מהידע הכללי שלך. אם הנתון לא קיים בחבילה, כתוב "אין לי את הנתון הזה בחבילה" והצע איזו תצוגה בדשבורד עשויה להכיל אותו.
2. צטט את המספרים שעליהם התשובה מבוססת, עם שם התקופה, השכבה והמכנה.
3. מידע, לא המלצות. אל תציע צעדים אלא אם נשאלת במפורש.
4. אל תמציא סיבות. אם יש כמה הסברים אפשריים, אמור שהנתונים לא מכריעים.

הגדרות:
- "זכאות למדד טק" (tech/ht) = תלמיד שלומד 5 יח"ל מתמטיקה + 5 יח"ל אנגלית + פיזיקה או מדעי המחשב ברמת 5 יח"ל. זה המדד. אין לסכום פיזיקה+מדמ"ח (יש חפיפה).
- המדד העירוני של שכבה = זכאים / כלל תלמידי השכבה. שני מכנים: "בתי הספר" (סכום שורות הגיליון, שדה students) ו"מצבת" (מצבת משרד החינוך, שדה matz). הדשבורד מציג את מכנה בתי הספר, והמצבת בסוגריים. ההשוואה לארצי ולרשויות אחרות נעשית תמיד במכנה המצבת ורק על שכבת יב'.
- "המשוקלל" = י'–יב' יחד. שכבות ז'–ט' אינן במדד.
- בית ספר עם partial=true הוא חלקי (אין לו י'–יב' מלאים) ואינו נכלל בדירוג ובנשירה.
- amat=1 בחט"ב: פיזיקה=מדמ"ח=זכאות, כלומר רישום לקבוצת עמ"ט ולא בחירת מקצוע.
- "מגמה י'→יב'" היא חתך של שלוש שכבות שונות באותה שנה, לא מעקב אחרי אותם תלמידים. מחושבת על אחוזים.
- עתיד טק: בטאב תחילת שנה (half=1) השורה = מי נכנס לתוכנית התגבור; בטאב סוף שנה (half=2) = מי מהנכנסים בחר במקצועות הטק. שיעור ההמרה = סוף/תחילה. ערך 0 = לא הוזן, לא אפס.
- שדות שורת שכבה (grades): total, cs, ph, ma5, ht, cs_g, ph_g, ht_g, amat, ma5_g, ft, ft_g, ma3, ma4, en5. סיומת _g = מספר התלמידות מתוך אותו מונה.
- holonOfficial: הסדרה הרשמית של משרד החינוך לחולון (שכבת יב', מכנה מצבת). national: הסדרות הארציות. cities: 33 רשויות לשנת 2024; big20 = 20 הגדולות, שבהן חולון מדורגת. רשויות ב-asterisk מוצגות אך מוחרגות מממוצעים.
- שנת לימודים: תשפ"ה = 2025 (סיום), תשפ"ו = 2026, וכן הלאה.`;

export default async function handler(req, res){
  const origin = req.headers.origin || '';
  const okOrigin = origin === ORIGIN || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  if(okOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if(req.method === 'OPTIONS') return res.status(204).end();
  if(req.method !== 'POST')    return res.status(405).json({ error: 'POST בלבד' });
  if(!okOrigin)                return res.status(403).json({ error: 'מקור לא מורשה' });
  if(!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: 'השירות לא הוגדר: חסר ANTHROPIC_API_KEY' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if(limited(ip)) return res.status(429).json({ error: 'יותר מדי שאלות. נסה שוב בעוד כמה דקות.' });

  const body = req.body || {};
  const question = String(body.question || '').trim();
  const payload  = body.payload;
  if(!question)                return res.status(400).json({ error: 'חסרה שאלה' });
  if(question.length > MAX_Q)  return res.status(400).json({ error: `השאלה ארוכה מדי (עד ${MAX_Q} תווים)` });
  if(!payload || typeof payload !== 'object')
                               return res.status(400).json({ error: 'חסרה חבילת נתונים' });
  const data = JSON.stringify(payload);
  if(data.length > MAX_BODY)   return res.status(413).json({ error: 'חבילת הנתונים גדולה מדי' });

  const client = new Anthropic();
  try{
    // החבילה יושבת ב-system אחרי ההגדרות, עם נקודת מטמון: השאלה השנייה
    // באותו סשן משלמת רק על עצמה. fallbacks="default": סירוב של מסנן
    // הבטיחות (נדיר בשאלות על נתוני חינוך) נענה ממודל חלופי באותה קריאה.
    const r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: 'חבילת הנתונים:\n' + data, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{ role: 'user', content: question }]
    });
    if(r.stop_reason === 'refusal')
      return res.status(200).json({ answer: 'המודל סירב לענות על השאלה הזו.', usage: r.usage });
    const answer = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return res.status(200).json({
      answer: answer || 'לא התקבלה תשובה.',
      truncated: r.stop_reason === 'max_tokens',
      usage: { input: r.usage.input_tokens, cached: r.usage.cache_read_input_tokens || 0, output: r.usage.output_tokens },
      model: r.model
    });
  }catch(e){
    if(e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: 'מפתח ה-API אינו תקף' });
    if(e instanceof Anthropic.RateLimitError)      return res.status(429).json({ error: 'השירות עמוס. נסה שוב בעוד רגע.' });
    if(e instanceof Anthropic.APIError)            return res.status(502).json({ error: `שגיאת API (${e.status})` });
    return res.status(502).json({ error: 'השירות לא הגיב' });
  }
}
