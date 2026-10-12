/* =========================================================================
   PRECONSTRUCTED DECKS — deck .json files in the game's own folder (see
   getPrecons/savePrecon in Code.gs). Decks hold card ids only, so a loaded
   one always shows today's cards. People who can edit the game folder also
   get the Precon button (add the open deck as one, or update the one it was
   loaded from) and a heads-up when a deck has cards that no longer exist.
   ========================================================================= */
let preconsLoading = null;
let preconsStatus = ''; // 'loading' | 'error' | '' — shown in the Load window
function preconModalOpen(){ return !document.getElementById('loadModal').classList.contains('hidden'); }
// notify: on game load, tell editors about out-of-date decks.
async function loadPrecons(notify){
  const gameId = state.currentGameFolderId;
  if(!gameId || preconsLoading) return preconsLoading;
  preconsStatus = 'loading';
  preconsLoading = (async ()=>{
    try{
      const res = await cardSource.precons(gameId);
      if(gameId !== state.currentGameFolderId) return; // switched games meanwhile
      state.precons = { canEdit: !!res.canEdit, decks: res.decks || [], boards: res.boards || [] };
      applyPcioUI(); // a game with room boards plays in the room instead of playingcards.io
      preconsStatus = '';
      applyPreconUI();
      const stale = state.precons.decks.filter(p=> p.missing && p.missing.length);
      if(notify && state.precons.canEdit && stale.length){
        const names = stale.slice(0,3).map(p=> p.name).join(', ') + (stale.length>3 ? '…' : '');
        toast(`${stale.length} preconstructed deck${stale.length>1?'s':''} contain${stale.length>1?'':'s'} removed cards: ${names}`, 'Review', ()=> document.getElementById('btnLoadDeck').click());
      }
    }catch(e){
      console.error('Could not load preconstructed decks:', e); // non-fatal: the section just stays as it was
      preconsStatus = 'error';
    }finally{
      preconsLoading = null;
      if(preconsStatus==='loading') preconsStatus = ''; // switched games meanwhile
      if(preconModalOpen()) renderPreconList();
    }
  })();
  if(preconModalOpen()) renderPreconList();
  return preconsLoading;
}
function applyPreconUI(){
  document.getElementById('btnPrecon').style.display = state.precons.canEdit ? '' : 'none';
}
function renderPreconList(){
  const decks = state.precons.decks;
  // While the list is being fetched (or if that failed), say so — with the
  // decks already known still listed underneath.
  applyLoadTabs();
  const status = document.getElementById('preconStatus');
  status.style.display = preconsStatus ? '' : 'none';
  status.innerHTML = preconsStatus==='loading'
    ? `<span class="mini-spinner"></span>${decks.length ? 'Checking for new preconstructed decks…' : 'Loading preconstructed decks…'}`
    : preconsStatus==='error' ? 'Couldn\'t load preconstructed decks — close and reopen this window to try again.' : '';
  const el = document.getElementById('preconList');
  el.innerHTML = decks.map((p,i)=>{
    const n = (p.missing||[]).length;
    const warn = state.precons.canEdit && n ? `<div class="precon-warn" title="Load it, swap those cards out, then use Precon ▾ › Update">⚠ ${n} removed card${n>1?'s':''} — needs updating</div>` : '';
    return `<div class="row-item">
      <span>${escapeHtml(p.name)} <span style="font-size:12px;color:var(--text-soft);">(${escapeHtml(p.deck.deckType)})</span>${warn}</span>
      <span class="btn btn-sm" data-precon="${i}">Load</span>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-precon]').forEach(b=> b.onclick = ()=> loadPreconDeck(decks[Number(b.dataset.precon)]));
}
// The Load window has two tabs, Preconstructed and Your decks. The tabs only
// appear when this game has preconstructed decks (or they're still loading);
// otherwise it's just your decks, as before. The last tab picked is remembered.
const LS_LOAD_TAB_KEY = 'eoo_deckbuilder_load_tab';
function applyLoadTabs(){
  const showTabs = !!(state.precons.decks.length || preconsStatus);
  let tab = 'precon';
  try{ tab = localStorage.getItem(LS_LOAD_TAB_KEY) || 'precon'; }catch(e){}
  if(!showTabs) tab = 'mine';
  document.getElementById('loadTabs').style.display = showTabs ? '' : 'none';
  document.querySelectorAll('#loadTabs .tab').forEach(t=> t.classList.toggle('active', t.dataset.loadtab===tab));
  document.getElementById('loadPanePrecon').style.display = tab==='precon' ? '' : 'none';
  document.getElementById('loadPaneMine').style.display = tab==='mine' ? '' : 'none';
  document.getElementById('nPreconTab').textContent = state.precons.decks.length ? `(${state.precons.decks.length})` : '';
  const mine = Object.keys(getSavedDecks()).length;
  document.getElementById('nMineTab').textContent = mine ? `(${mine})` : '';
}
document.getElementById('loadTabs').addEventListener('click', e=>{
  const t = e.target.closest('[data-loadtab]');
  if(!t) return;
  try{ localStorage.setItem(LS_LOAD_TAB_KEY, t.dataset.loadtab); }catch(err){}
  applyLoadTabs();
});
function loadPreconDeck(p){
  importDeckFromJson(p.deck);
  curDeck().name = p.name;
  curDeck().preconFileId = p.fileId;
  document.getElementById('deckNameInput').value = p.name;
  document.getElementById('loadModal').classList.add('hidden');
  renderAll();
  toast(`Loaded the preconstructed deck "${p.name}".`);
}

document.getElementById('btnPrecon').addEventListener('click', ()=>{
  const body = document.getElementById('preconModalBody');
  const fromPrecon = curDeck().preconFileId ? state.precons.decks.find(p=> p.fileId===curDeck().preconFileId) : null;
  const name = document.getElementById('deckNameInput').value.trim();
  body.innerHTML = `
    <p style="margin-top:0;color:var(--text-soft);font-size:13px;">Shares the deck that's open now with every player who can see its cards. They'll find it under Load ▾ right away.</p>
    ${fromPrecon ? `<p style="font-size:13px;">This deck was loaded from <b>${escapeHtml(fromPrecon.name)}</b>.</p>
      <div class="btn btn-accent" id="btnPreconUpdate" style="justify-content:center;width:100%;box-sizing:border-box;margin-bottom:8px;">Update "${escapeHtml(fromPrecon.name)}"</div>` : ''}
    <div class="btn ${fromPrecon?'':'btn-accent'}" id="btnPreconAdd" style="justify-content:center;width:100%;box-sizing:border-box;">Add as a new precon${name ? ` — "${escapeHtml(name)}"` : ''}</div>`;
  document.getElementById('preconModal').classList.remove('hidden');
  if(fromPrecon) document.getElementById('btnPreconUpdate').onclick = ()=> savePreconDeck(fromPrecon.fileId);
  document.getElementById('btnPreconAdd').onclick = ()=> savePreconDeck('');
});

// fileId: the deck file to overwrite, or '' to add a new one.
async function savePreconDeck(fileId){
  let name = document.getElementById('deckNameInput').value.trim();
  if(!name){
    name = (prompt('Name this preconstructed deck:') || '').trim();
    if(!name) return;
    curDeck().name = name;
    document.getElementById('deckNameInput').value = name;
  }
  const deck = deckJsonData(new Date().toISOString());
  const ids = [...deckCodec().referencedIds(deck), ...Object.keys(deck.deckCards||{})].filter(Boolean);
  if(!ids.length){ toast('This deck is empty.'); return; }
  const gone = [...new Set(ids)].filter(id=> !state.byId.has(id));
  if(gone.length && !confirm(`This deck still has ${gone.length} card${gone.length>1?'s':''} that no longer exist${gone.length>1?'':'s'}. Save it anyway?`)) return;
  const send = (replace)=> cardSource.savePrecon(fileId, deck, replace);
  try{
    toast('Saving the preconstructed deck…');
    let res = await send(false);
    if(res.exists){
      if(!confirm(`There's already a deck file named "${res.fileName}" in the game folder. Replace it with this deck?`)) return;
      res = await send(true);
    }
    curDeck().preconFileId = res.fileId;
    document.getElementById('preconModal').classList.add('hidden');
    await loadPrecons(false);
    toast(res.created ? `Added "${name}" as a preconstructed deck — players can load it now.` : `Updated the preconstructed deck "${name}".`);
  }catch(e){
    toast('Could not save the preconstructed deck: ' + e.message);
  }
}

/* =========================================================================
   SEND DECK TO ROOM — hands the open deck (and, for a new room, the chosen
   board layout) to room.html in a new tab. Both pages are on the same site,
   so the hand-off rides localStorage (key below); the room picks it up after
   sign-in, loads the board, places the deck and opens or joins the room.
   ========================================================================= */
const ROOM_HANDOFF_KEY = 'eoo_room_handoff';
let sendRoomMode = 'new';
document.getElementById('btnSendToRoom').addEventListener('click', ()=>{
  const boards = state.precons.boards || [];
  const name = document.getElementById('deckNameInput').value.trim() || 'Untitled deck';
  const deck = deckJsonData(new Date().toISOString());
  const n = deckCodec().referencedIds(deck).filter(Boolean).length
    + Object.values(deck.deckCards||{}).reduce((a,b)=>a+Number(b||0),0);
  const body = document.getElementById('sendRoomBody');
  body.innerHTML = `
    <p style="margin-top:0;font-size:13px;"><b>${escapeHtml(name)}</b> <span style="color:var(--text-soft);">(${escapeHtml(deck.deckType)}, ${n} card${n===1?'':'s'})</span> — goes onto the table shuffled and face down.</p>
    <label class="send-room-choice" data-mode="new"><input type="radio" name="sendRoomMode" value="new">
      <div><b>Start a new room</b>
        <div class="src-sub">${boards.length>1
          ? `Board <select id="sendRoomBoard">${boards.map((b,i)=>`<option value="${i}">${escapeHtml(b.name)}</option>`).join('')}</select>`
          : `Board: ${escapeHtml(boards[0] ? boards[0].name : '—')}`}</div></div></label>
    <label class="send-room-choice" data-mode="join"><input type="radio" name="sendRoomMode" value="join">
      <div><b>Join a room that's already going</b>
        <div class="src-sub">Room code <input type="text" id="sendRoomCode" maxlength="12" placeholder="e.g. K3XQ7P" autocomplete="off"></div></div></label>
    <div id="sendRoomError" style="color:var(--danger);font-size:12.5px;min-height:16px;"></div>
    <div class="btn btn-accent" id="btnSendRoomGo" style="justify-content:center;width:100%;box-sizing:border-box;">Open room ↗</div>`;
  const setMode = m=>{
    sendRoomMode = m;
    body.querySelectorAll('.send-room-choice').forEach(el=>{ el.classList.toggle('on', el.dataset.mode===m); el.querySelector('input[type=radio]').checked = el.dataset.mode===m; });
  };
  body.querySelectorAll('.send-room-choice').forEach(el=> el.addEventListener('click', ()=> setMode(el.dataset.mode)));
  document.getElementById('sendRoomCode').addEventListener('focus', ()=> setMode('join'));
  document.getElementById('sendRoomCode').addEventListener('input', e=>{ const el = e.target, at = el.selectionStart; el.value = el.value.toUpperCase(); el.setSelectionRange(at, at); });
  document.getElementById('sendRoomCode').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('btnSendRoomGo').click(); });
  setMode(sendRoomMode);
  document.getElementById('btnSendRoomGo').addEventListener('click', ()=>{
    const err = document.getElementById('sendRoomError');
    if(!n){ err.textContent = 'This deck is empty.'; return; }
    if(!deck.sourceSheets || !deck.sourceSheets.length){ err.textContent = 'None of this deck\'s cards are loaded yet — wait a moment and try again.'; return; }
    const code = document.getElementById('sendRoomCode').value.trim().toUpperCase();
    if(sendRoomMode==='join' && !code){ err.textContent = 'Type the room code.'; return; }
    const sel = document.getElementById('sendRoomBoard');
    const board = sendRoomMode==='new' ? boards[sel ? Number(sel.value) : 0] : null;
    const handoff = { at: Date.now(), mode: sendRoomMode, code: sendRoomMode==='join' ? code : '', deck: {...deck, name},
      board: board ? board.layout : null, boardName: board ? board.name : '', gameFolderId: state.currentGameFolderId };
    try{ localStorage.setItem(ROOM_HANDOFF_KEY, JSON.stringify(handoff)); }
    catch(e){ err.textContent = 'Could not hand the deck over: ' + e.message; return; }
    window.open('room.html', '_blank');
    document.getElementById('sendRoomModal').classList.add('hidden');
  });
  document.getElementById('sendRoomModal').classList.remove('hidden');
});

