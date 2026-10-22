# רענון נתוני התמונה החינוכית: הקמה חד-פעמית

האתר shkifut.education.gov.il מחזיר 403 לכל כתובת שאינה ישראלית. נבדק ב-22.10.2026:
Chromium ו-Firefox אמיתיים, מ-GitHub Actions בשיקגו, נחסמים על כל כתובת באתר, בלי
כותרות של חומת אש לבוטים. זו חסימה לפי מדינה, ולכן השליפה חייבת לרוץ ממחשב ישראלי.

## דרך א: runner על המחשב שלך (מומלץ, מאפשר ל-Claude להפעיל רענון)
1. בריפו: Settings, Actions, Runners, New self-hosted runner, macOS. מעתיקים את
   הפקודות ומריצים אותן במחשב. בשלב `./config.sh` מוסיפים `--labels israel`.
2. `./run.sh` (או `sudo ./svc.sh install && sudo ./svc.sh start` כדי שירוץ תמיד).
3. הרצה: Actions, refresh-data, Run workflow. `dry` מציג דוח השוואה בלי לכתוב.
   ה-job שולף, מאמת, משווה לקובץ הקיים, ורק אז עושה commit ל-main.
   (Claude יכול להפעיל אותו בעצמו דרך ה-API כשה-runner מחובר.)

⚠ הריפו ציבורי. runner עצמי בריפו ציבורי הוא סיכון אם מישהו מבחוץ יכול להריץ עליו
workflow. ה-workflow כאן רק `workflow_dispatch`, אבל חייבים גם: Settings, Actions,
General, "Fork pull request workflows from outside collaborators", לבחור
**Require approval for all outside collaborators**.

## דרך ב: בלי runner, ידנית
```
npm install --prefix tools
node tools/refresh-data.mjs --dry     # דוח השוואה בלבד
node tools/refresh-data.mjs           # כותב BigPicture/data.json
git add BigPicture/data.json && git commit -m "רענון נתונים" && git push origin main
```
צריך Chrome מותקן, או `cd tools && npx playwright-core install chromium`.

## מה הסקריפט מבטיח
- מריץ בתוך האתר את `eduCollect` של הדף עצמו: אין פרסר שני שיכול לסטות.
- לא כותב קובץ אם חסרים חולון או הארצי, אם ערך מחוץ ל-0..100, אם אין שדות אשכול
  ומחוז, או אם יותר מ-20% מהערכים הקיימים השתנו (כנראה שליפה שבורה; `--force` עוקף).
- מדפיס כמה ערכים נבדקו מול הקובץ הקיים וכמה השתנו.

## דרך ג: שליפה בדפדפן ישראלי, עיבוד במקום אחר (`--from`)
כשיש רק דפדפן (למשל הדפדפן המובנה של Claude Desktop) ואין צורך ב-runner: מריצים בתוך
האתר `await eduCollect('', ()=>{}, null, 66001)` (הקוד ב-BigPicture/index.html), שומרים את
`JSON.stringify` של התוצאה לקובץ, ואז בכל מחשב: `node tools/refresh-data.mjs --from raw.json`.
אותו ניקוי, אימות והשוואה כמו בשליפה ישירה.
