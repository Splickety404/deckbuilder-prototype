/* =========================================================================
   EXPORT
   ========================================================================= */
function openExportModal(){
  const printCount = buildPrintList().length;
  const pages = Math.ceil(printCount / 9); // 3x3 grid per Letter page
  document.getElementById('pdfPageEstimate').textContent = printCount
    ? `~${pages} page${pages!==1?'s':''} (${printCount} card image${printCount!==1?'s':''})`
    : 'Nothing to export yet.';
  document.getElementById('exportModal').classList.remove('hidden');
}
document.getElementById('btnExport').addEventListener('click', ()=>{
  // An unnamed deck gets one chance to pick up a name before exporting — but naming
  // is never required, so "Export without a name" (below) just falls through to
  // openExportModal() same as if the deck already had one.
  if(document.getElementById('deckNameInput').value.trim()){
    openExportModal();
  }else{
    document.getElementById('exportNameInput').value = '';
    document.getElementById('exportNameModal').classList.remove('hidden');
  }
});
document.getElementById('btnExportSaveName').addEventListener('click', ()=>{
  const name = document.getElementById('exportNameInput').value.trim();
  if(name){
    curDeck().name = name;
    document.getElementById('deckNameInput').value = name;
  }
  document.getElementById('exportNameModal').classList.add('hidden');
  openExportModal();
});
document.getElementById('btnExportWithoutName').addEventListener('click', ()=>{
  document.getElementById('exportNameModal').classList.add('hidden');
  openExportModal();
});
// Enter in the name field acts like "Save name & continue" rather than doing nothing.
document.getElementById('exportNameInput').addEventListener('keydown', (e)=>{
  if(e.key==='Enter') document.getElementById('btnExportSaveName').click();
});

function deckFileBase(){ return (document.getElementById('deckNameInput').value.trim()||'deck').replace(/[^a-z0-9-_]+/gi,'_'); }
function downloadBlob(content, filename, type){
  const blob = new Blob([content], {type});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// Print order: whatever the game's deck codec puts first (printLead — e.g. a leader), then the deck
// itself in the order you arranged it.
function buildPrintList(){
  const list=[];
  const pushCard = (card) => {
    if(!card) return;
    list.push({card, side:'front'});
    if(card._doubleSided) list.push({card, side:'back'});
  };
  deckCodec().printLead(curDeck()).forEach(pushCard);
  curDeck().deckOrder.forEach(id=>{
    const n = curDeck().deckCards.get(id)||0;
    const c=state.byId.get(id); if(!c) return;
    for(let i=0;i<n;i++) pushCard(c);
  });
  return list;
}

const PDF_JPEG_QUALITY = 0.8; // genuine, controllable compression — this was the actual missing lever: previously we just embedded whatever raw bytes the host served (often PNG-ish for painted art, much larger than an equivalent JPEG at a quality difference nobody would notice in print)
// A real card render is always at least a few hundred px on its short side. If the
// fetch/decode "succeeds" but hands back something tiny — a host quietly substituting a small
// "can't preview this file" icon instead of a proper HTTP error — no exception gets thrown
// anywhere, so that little icon would be embedded as if it were the card's real art: no
// failure reported, no text fallback, just a page of near-blank cards. Guarding on size turns
// that into a normal, counted failure (text fallback + the "N image(s) failed" count).
const MIN_EMBEDDABLE_DIM = 100;
async function urlToDataUrl(url){
  const res = await fetch(url, {mode:'cors'});
  if(!res.ok) throw new Error('fetch failed: HTTP '+res.status);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  if(bitmap.width < MIN_EMBEDDABLE_DIM || bitmap.height < MIN_EMBEDDABLE_DIM){
    throw new Error(`image came back suspiciously small (${bitmap.width}x${bitmap.height}) — likely a "can't preview" placeholder, not real art`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); // JPEG has no alpha — without this, any transparency in the source turns black
  ctx.drawImage(bitmap, 0, 0);
  return canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY);
}

document.getElementById('optExportPdf').addEventListener('click', async ()=>{
  warnAboutMissingCards();
  const prog = document.getElementById('export-progress');
  prog.style.display='block';
  const list = buildPrintList();
  if(!list.length){ toast('Nothing to export yet.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:'letter'});
  const PAGE_W=612, PAGE_H=792;
  const CARD_W_FULL=180, CARD_H_FULL=252; // nominal 2.5in x 3.5in
  const IMG_SCALE=0.97; // 3% smaller than nominal, for easier sleeving
  // The grid cell itself is sized at the shrunk dimensions (not the nominal size with the
  // image centered inside it) so adjacent cells — and their cut lines — sit edge-to-edge
  // with zero gap between them. That way a single straight cut serves both neighboring
  // cards, instead of leaving a blank sliver that needs trimming away separately.
  const CARD_W=CARD_W_FULL*IMG_SCALE, CARD_H=CARD_H_FULL*IMG_SCALE;
  const COLS=3, ROWS=3;
  const MARGIN_X=(PAGE_W-CARD_W*COLS)/2, MARGIN_Y=(PAGE_H-CARD_H*ROWS)/2;

  let failCount=0;
  for(let i=0;i<list.length;i++){
    prog.textContent = `Rendering card ${i+1} / ${list.length}...`;
    const cellIdx = i % (COLS*ROWS);
    if(cellIdx===0 && i!==0) doc.addPage();
    const col = cellIdx % COLS, row = Math.floor(cellIdx/COLS);
    const x = MARGIN_X + col*CARD_W, y = MARGIN_Y + row*CARD_H;

    const {card, side} = list[i];
    // 900px wide comfortably clears 300 DPI at this card's ~2.4in physical width — good
    // print quality without pulling the full source resolution, which is print-production
    // scale (and was the main driver of the old PDF's large file size). force:true here
    // because PDF export always wants this fixed width, even for a card whose art is a
    // plain PNG/JPEG that the on-screen previews now fetch at native size.
    const url = side==='front' ? sizedUrl(card._front, 900, true) : sizedUrl(card._back, 900, true);

    doc.setDrawColor(180,183,190); doc.rect(x,y,CARD_W,CARD_H);

    let dataUrl=null;
    if(url){
      // Logged (not just counted) so an actual failure — a real CORS/network
      // error vs. the "suspiciously small" placeholder guard above vs.
      // something else entirely — is visible in the browser console instead
      // of every failure looking identical from the outside.
      try{ dataUrl = await urlToDataUrl(url); }catch(e){ failCount++; dataUrl=null; console.error('PDF export: art failed to embed for', card.name, `(${side})`, url, e); }
    }
    if(dataUrl){
      doc.addImage(dataUrl, 'JPEG', x, y, CARD_W, CARD_H);
    } else {
      doc.setFontSize(10);
      doc.text(doc.splitTextToSize(card.name + (side==='back'?' (back)':''), CARD_W-16), x+8, y+20);
    }
  }
  prog.textContent = failCount ? `Done, with ${failCount} image(s) that failed to embed (drawn as text instead).` : 'Done!';
  doc.save(deckFileBase() + '_print_and_play.pdf');
});

// A double-sided card (currently just leaders) keeps its own real back. Every other
// card falls back to the shared generic back for its side — only relevant for
// exports; nothing else in the app needs to show these generic backs at all.
// Cards this deck references (leader, bonus, extra, schemes, deck) that no longer
// exist in the live feed — used to warn before an export silently omits them.
function missingReferencedCardIds(){
  const missing = [];
  const check = (id) => { if(id && !state.byId.has(id)) missing.push(id); };
  deckCodec().referencedIds(curDeck()).forEach(check);
  for(const id of curDeck().deckCards.keys()) check(id);
  return missing;
}
function warnAboutMissingCards(){
  const missing = missingReferencedCardIds();
  if(!missing.length) return;
  const names = missing.map(id=>{
    const info = removedCardCache.get(id);
    return (info && info!=='loading' && info!=='not-found') ? info.name : id;
  });
  toast(`Heads up: ${missing.length} card${missing.length>1?'s':''} in this deck ${missing.length>1?'were':'was'} removed from the game and will NOT appear in this export: ${names.slice(0,3).join(', ')}${names.length>3?'…':''}`);
}

function backUrlForExport(card){
  if(card._doubleSided && card._back) return card._back;
  return state.game.backUrl(card);
}
// Strips the internal "#img-src"/"#pdf-src" marker fragment (see sizedUrl()) before
// a URL leaves the app in an export — playingcards.io would ignore it harmlessly
// either way (fragments are never sent over the network), but there's no reason to
// hand external, user-facing data an implementation detail it has no use for.
function stripArtUrlMarker(url){ return url ? url.split('#')[0] : url; }
function csvForCardList(cardList){
  const rows = [['name','front','back']];
  cardList.forEach(card=> rows.push([card.name, stripArtUrlMarker(card._front), stripArtUrlMarker(backUrlForExport(card))]));
  return rows.map(r=> r.map(f=>`"${String(f).replace(/"/g,'""')}"`).join(',')).join('\n');
}
function expandedDeckList(){
  // one entry per physical copy, in the deck's stacked order
  const list = [];
  curDeck().deckOrder.forEach(id=>{
    const n = curDeck().deckCards.get(id)||0;
    const c = state.byId.get(id); if(!c) return;
    for(let i=0;i<n;i++) list.push(c);
  });
  return list;
}

document.getElementById('optExportCsv').addEventListener('click', ()=>{
  warnAboutMissingCards();
  const files = deckCodec().csvFiles();
  if(files.error){ toast(files.error); return; }
  files.forEach((f, i)=>{
    const save = ()=> downloadBlob(csvForCardList(f.cards), deckFileBase()+f.suffix, 'text/csv');
    if(i===0) save();
    else setTimeout(save, 200); // small stagger so browsers don't treat the second download as blocked/suspicious
  });
});

function buildDecklistTextLines(exportedAtIso){
  const lines = [];
  lines.push(`# ${document.getElementById('deckNameInput').value.trim() || 'Untitled Deck'}`);
  lines.push(`# Deck type: ${activeDeckKey()}`);
  if(exportedAtIso) lines.push(`# Exported: ${exportedAtIso}`);
  lines.push(...deckCodec().textSetupLines(curDeck()));
  lines.push('');
  lines.push(...deckCodec().textSchemeLines(curDeck()));
  lines.push('Deck:');
  curDeck().deckOrder.forEach(id=>{
    const n = curDeck().deckCards.get(id)||0; const c=state.byId.get(id);
    if(c && n>0) lines.push(`${n}x ${c.name}`);
  });
  return lines;
}

document.getElementById('optExportTxt').addEventListener('click', ()=>{
  const now = new Date().toISOString();
  curDeck().sourceExportedAt = now; // exporting now bookmarks "current" as the new changed-since baseline
  downloadBlob(buildDecklistTextLines(now).join('\n'), deckFileBase()+'.txt', 'text/plain');
  renderAll(); // clears any stale "changed since export" badges, since this IS the new export
});

document.getElementById('optExportClipboard').addEventListener('click', async ()=>{
  const text = buildDecklistTextLines(null).join('\n'); // no timestamp — this isn't a formal export checkpoint
  try{
    await navigator.clipboard.writeText(text);
    toast('Decklist copied to clipboard.');
  }catch(e){
    toast('Could not copy to clipboard: '+e.message);
  }
});

// Every distinct sheet actually referenced by this deck's cards — carried in the
// JSON export so the game room app can resolve card art/names without any sheet
// id hardcoded in its own source. A deck mixing Set 1 and Set 2 cards yields 2 entries.
function computeSourceSheets(){
  const ids = [...deckCodec().referencedIds(curDeck()).filter(Boolean), ...curDeck().deckOrder];
  const seen = new Map(); // sheetId -> setName
  ids.forEach(id=>{
    const c = state.byId.get(id);
    if(c && c._sheetId && !seen.has(c._sheetId)) seen.set(c._sheetId, c._setName);
  });
  return [...seen.entries()].map(([sheetId, setName])=>({sheetId, setName}));
}

// The deck as a .json decklist — also the preconstructed-deck file format.
function deckJsonData(now){
  return {
    formatVersion:2, // v2 adds sourceSheets
    name: document.getElementById('deckNameInput').value.trim()||'Untitled Deck',
    deckType: activeDeckKey(),
    exportedAt: now,
    ...deckCodec().jsonFields(curDeck()),
    deckOrder: curDeck().deckOrder,
    deckCards: Object.fromEntries(curDeck().deckCards),
    sourceSheets: computeSourceSheets(),
  };
}
document.getElementById('optExportJson').addEventListener('click', ()=>{
  const now = new Date().toISOString();
  curDeck().sourceExportedAt = now;
  const data = deckJsonData(now);
  downloadBlob(JSON.stringify(data,null,2), deckFileBase()+'.json', 'application/json');
  renderAll();
});

