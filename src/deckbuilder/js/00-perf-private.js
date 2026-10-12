/* =========================================================================
   LOAD TIMING (private). perfMark('step') notes how long after the page started
   each start-up step finished — open the browser console to read it. Purely
   diagnostic: it changes nothing about how the app loads.
   ========================================================================= */
window.__loadTimings = [];
function perfMark(label){
  const t = Math.round(performance.now());
  window.__loadTimings.push({ step: label, ms: t });
  console.info(`[load] ${label} — ${t} ms after page start`);
}
function perfReport(){
  let prev = 0;
  console.table(window.__loadTimings.map(m=>{ const row = { step: m.step, 'at (ms)': m.ms, 'step took (ms)': m.ms - prev }; prev = m.ms; return row; }));
}
perfMark('page script started');
