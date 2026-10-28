/* ---- TABLETOP SIMULATOR EXPORT — a .csv with one row per card copy: a direct link to the
   card's front image and one to its back. A card with no back of its own gets its game's
   shared card back (TTS_CARD_BACKS, by game name in lowercase). Offered for every game except Echo,
   whose export menu stays as it was. ---- */
const TTS_CARD_BACKS = {
  'hellbreak': 'https://lh3.googleusercontent.com/d/1cp-bUP4qV7_Ex9Wf_jml8ab2atgmpMml',
};
const TTS_IMAGE_WIDTH = 1500; // only matters for art sourced from a PDF, which has to be rendered at some width
function ttsImageLink(url){ return url ? sizedUrl(url, TTS_IMAGE_WIDTH) : ''; }
function csvCell(s){ s = String(s||''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }

function buildTtsCsv(){
  const sharedBack = TTS_CARD_BACKS[String(state.currentGameLabel||'').trim().toLowerCase()] || '';
  const rows = [['front','back']];
  let noFront = 0, noBack = 0;
  const pushCard = (card) => {
    if(!card) return;
    const front = ttsImageLink(card._front);
    const back = ttsImageLink(card._back) || sharedBack;
    if(!front) noFront++;
    if(!back) noBack++;
    rows.push([front, back]);
  };
  deckCodec().printLead(curDeck()).forEach(pushCard);
  curDeck().deckOrder.forEach(id=>{
    const n = curDeck().deckCards.get(id)||0;
    const c = state.byId.get(id); if(!c) return;
    for(let i=0;i<n;i++) pushCard(c);
  });
  return { csv: rows.map(r=> r.map(csvCell).join(',')).join('\r\n') + '\r\n', count: rows.length-1, noFront, noBack };
}

document.getElementById('optExportTts').addEventListener('click', async ()=>{
  if(artStillLoading) toast('Waiting for the latest card art…');
  if(!await waitForLatestArt()) toast('Could not confirm the latest card art — this export may link older art for some cards.');
  const {csv, count, noFront, noBack} = buildTtsCsv();
  if(!count){ toast('Nothing to export yet.'); return; }
  downloadBlob(csv, deckFileBase()+'-tts.csv', 'text/csv;charset=utf-8');
  document.getElementById('exportModal').classList.add('hidden');
  const missing = [];
  if(noFront) missing.push(`${noFront} without front art`);
  if(noBack) missing.push(`${noBack} without a back image`);
  toast(missing.length ? `Exported ${count} cards — ${missing.join(', ')}.` : `Exported ${count} cards for Tabletop Simulator.`);
});
// Shown for every game but Echo (checked each time the export menu opens).
document.getElementById('btnExport').addEventListener('click', ()=>{
  document.getElementById('optExportTts').style.display = state.game.id==='echo' ? 'none' : '';
});
