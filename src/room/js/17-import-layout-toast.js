/* =========================================================================
   DECK IMPORT WIRING
   ========================================================================= */
// Set by the board menu's Import Deck (see openBoardRadialMenu) so the deck
// lands where you right-clicked.
let pendingDeckDropWorld = null;
document.getElementById('deckFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  toast('Reading deck file…');
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const json = JSON.parse(reader.result);
      const drop = pendingDeckDropWorld;
      pendingDeckDropWorld = null;
      if(drop){
        const at = snapPos(drop.x - PIECE_W/2, drop.y - PIECE_H/2, PIECE_W, PIECE_H); await importDeckJson(json, at.x, at.y); // centered on the click
      } else {
        const b = boardBounds();
        await importDeckJson(json, (b.minX+b.maxX)/2, (b.minY+b.maxY)/2);
        fitAll();
      }
    }catch(err){
      toast('Could not read that deck file: '+err.message);
    }
  };
  reader.readAsText(file);
  e.target.value='';
});

/* =========================================================================
   LAYOUT EXPORT / IMPORT — the whole shared board (pieces, tokens + their
   user-defined types, zones, table theme), plus exactly the decks needed to
   resolve every card in it. Never includes any player's private hand — hands
   are personal, per-player state and were never shared/synced to begin with.
   ========================================================================= */
function exportLayout(){
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    sourceSheets: sourceSheetsInUse(),
    theme: { ...state.theme },
    tokenTypes: [...state.tokenTypes.entries()],
    tokenTypeStyles: [...state.tokenTypeStyles.entries()],
    tabs: state.tabs.map(t=>({...t})),
    zones: [...state.zones.values()],
    pieces: [...state.pieces.values()],
    tokens: [...state.tokens.values()],
    deckRecords: [...state.deckRecords.values()],
    gameFolderId: state.gameFolderId,
  };
}
document.getElementById('btnExportLayout').addEventListener('click', ()=>{
  const data = exportLayout();
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game-room-layout-${state.sessionCode||'untitled'}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Layout exported.');
});
document.getElementById('btnImportLayout').addEventListener('click', ()=> document.getElementById('layoutFileInput').click());
document.getElementById('layoutFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const json = JSON.parse(reader.result);
      if(!confirm('Loading this layout replaces the CURRENT board for everyone at the table. Continue?')) return;
      // No pre-flight wait: LOAD_LAYOUT's own applyRoomEvent case registers
      // "Access Pending" placeholders and resolves every set's access in the
      // background (see registerPendingCards/ensureSheetsLoaded there), same
      // as importDeckJson — the board comes back immediately either way.
      doAction('LOAD_LAYOUT', {
        sourceSheets: json.sourceSheets||[],
        theme: json.theme||null,
        tokenTypes: json.tokenTypes||[],
        tokenTypeStyles: json.tokenTypeStyles||[],
        tabs: json.tabs||null,
        zones: json.zones||[],
        pieces: json.pieces||[],
        tokens: json.tokens||[],
        deckRecords: json.deckRecords||[],
        gameFolderId: json.gameFolderId||'',
      });
      fitAll();
      toast('Layout loaded.');
    }catch(err){
      toast('Could not read that layout file: '+err.message);
    }
  };
  reader.readAsText(file);
  e.target.value='';
});

/* =========================================================================
   TOAST
   ========================================================================= */
document.querySelectorAll('[data-close]').forEach(el=>{
  el.addEventListener('click', ()=> document.getElementById(el.dataset.close).classList.add('hidden'));
});

let _toastTimer=null;
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=> t.style.display='none', 3600);
}

