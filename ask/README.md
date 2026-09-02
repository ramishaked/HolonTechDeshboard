# holon-tech-ask — השירות מאחורי "שאלה על הנתונים"

פונקציית Serverless אחת (`api/ask.js`) שמקבלת מהדשבורד שאלה וחבילת מדדים,
פונה ל-Claude ומחזירה תשובה. המפתח נשאר כאן ולא בדף.

**זה פרויקט Vercel נפרד** שתיקיית השורש שלו היא `ask/` בריפו הזה. שאר
הריפו (הדשבורד ב-GitHub Pages) לא נפרס ל-Vercel ולא תלוי בו: אם השירות
נופל, רק תצוגה 13 מציגה שגיאה.

## הקמה חד-פעמית
1. Vercel → Add New Project → הריפו `ramishaked/HolonTechDeshboard`,
   **Root Directory = `ask`**. Framework: Other. בלי פקודת build.
2. Settings → Environment Variables:
   - `ANTHROPIC_API_KEY` — חובה. אף אחד מלבדך לא צריך לראות אותו.
   - `ALLOWED_ORIGIN` — רשות. ברירת מחדל `https://ramishaked.github.io`.
   - `ASK_MODEL` — רשות. ברירת מחדל `claude-opus-5`.
   - `ANTHROPIC_WORKSPACE_ID` — רק אם המפתח הוא "identity-linked" (ה-API
     עונה אז `anthropic-workspace-id is required`). המזהה בקונסול של
     Anthropic: Settings → Workspaces → ה-workspace שבו נוצר המפתח,
     מתחיל ב-`wrkspc_`.
3. Redeploy אחרי הוספת המשתנים.
4. בקונסול של Anthropic: **מגבלת הוצאה חודשית** לארגון. זו רשת הבטחון
   האמיתית; מגבלת הקצב שבקוד היא per-מופע ולכן חלקית.
5. את כתובת הפרויקט (`https://<project>.vercel.app`) מציבים ב-`ASK_URL`
   שב-`index.html`.

## בדיקה
```
curl -i -X OPTIONS https://<project>.vercel.app/api/ask \
  -H 'Origin: https://ramishaked.github.io' -H 'Access-Control-Request-Method: POST'
curl -s -X POST https://<project>.vercel.app/api/ask \
  -H 'Origin: https://ramishaked.github.io' -H 'Content-Type: application/json' \
  -d '{"question":"מה המדד ביב׳?","payload":{"city":{"יב":{"techPctMatz":14.2}}}}'
```
Origin אחר צריך להחזיר 403.

## מה השירות לא עושה
- לא מחשב. כל מספר בתשובה מגיע מהחבילה שהדף בנה.
- לא שומר שאלות, תשובות או כתובות IP.
- לא מגיש דפים. `index.html` נשאר ב-GitHub Pages.
