/* ── תחליף Chart.js להרצת האימות המקומית ──────────────────────────
   הדשבורד טוען את Chart.js מ-cdnjs. בסביבת הפיתוח cdnjs חסום, ובכל
   מקרה אין טעם לצייר גרפים אמיתיים בבדיקה אוטומטית: מה שצריך להיבדק
   הוא שהקוד שבונה את הקונפיגורציה רץ בלי לזרוק.

   הסטאב מספק את המשטח היחיד שהדשבורד נוגע בו:
     new Chart(canvas, config) · chart.destroy() · Chart.register()
   ובנוסף שומר את הקונפיגורציה, כדי ש-verify.mjs יוכל לוודא שכל גרף
   באמת נבנה ולא רק ש"אין שגיאה".
   ⚠ אינו חלק מהאפליקציה. GitHub Pages לא מגיש את tools/.
─────────────────────────────────────────────────────────────────── */
(function (g) {
  var built = [];

  function Chart(ctx, config) {
    this.ctx = ctx;
    this.config = config || {};
    this.data = this.config.data || { labels: [], datasets: [] };
    this.options = this.config.options || {};
    this.canvas = ctx && ctx.canvas ? ctx.canvas : ctx;
    this.id = (this.canvas && this.canvas.id) || '(anonymous)';
    built.push({ id: this.id, type: this.config.type, sets: (this.data.datasets || []).length });
  }
  Chart.prototype.destroy = function () { this.destroyed = true; };
  Chart.prototype.update = function () {};
  Chart.prototype.resize = function () {};
  Chart.prototype.getDatasetMeta = function () { return { data: [] }; };

  Chart.register = function () {};
  Chart.unregister = function () {};
  Chart.getChart = function () { return null; };
  Chart.defaults = { font: {}, plugins: {}, color: '#000', scale: {}, scales: {} };
  Chart.registry = { plugins: { register: function () {} } };

  g.Chart = Chart;
  g.ChartDataLabels = { id: 'datalabels' };
  g.__CHARTS_BUILT__ = built;          // נקרא מ-verify.mjs
})(window);
