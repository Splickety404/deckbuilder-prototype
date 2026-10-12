/* =========================================================================
   CONNECTING A ROOM — open it up to others once you're happy with your local
   board (pushes it as the shared starting layout), or join one already
   underway (adopts its shared board in place of your local one). Either way
   this can happen at any time, not just at the very start.
   ========================================================================= */
function connectToRoom({code, isHost}){
  state.sessionCode = code;
  localStorage.setItem(LS_LAST_SESSION_CODE_KEY, code);
  state.hasInitialState = false;
  const channelReady = initRoomChannel();
  if(!channelReady){
    setConnStatus(false, 'not configured');
    toast('Live sync isn\'t set up yet (missing Ably key) — see the setup notes near ABLY_API_KEY in room.html.');
  }
  if(isHost){
    // Whatever you've already built locally becomes the room's starting layout.
    doAction('LOAD_LAYOUT', exportLayout());
    state.hasInitialState = true;
  } else {
    // Joining adopts the shared room's board instead of merging with it —
    // clear local content first, then ask whoever's already there for the
    // current state (see REQUEST_STATE/STATE_SNAPSHOT in applyRoomEvent) —
    // arrives in well under a second rather than waiting on a poll cycle.
    state.pieces.clear(); state.tokens.clear(); state.zones.clear(); state.tokenTypes.clear();
    state.players.clear(); state.turnOrder = []; state.turnIndex = -1;
    renderBoard();
    if(channelReady) requestStateSync();
  }
  doAction('PLAYER_JOINED', {playerId: state.playerId, playerName: state.playerName});
  updateConnectionUI();
  toast(isHost ? `Room open — session code ${code}` : `Joined session ${code}`);
}
/* =========================================================================
   ARRIVING FROM THE DECKBUILDER ("Send deck to room") — it leaves the deck,
   and for a new room the game's board layout, in localStorage under
   ROOM_HANDOFF_KEY and opens this page. Taken at page load (moved into this
   tab's sessionStorage, so a second room tab can't also take it, while a
   reload of this tab still has it), then used right after sign-in:
     new room:  load the board, place the deck, open the room (code shown)
     join room: join with the code, wait for the table, place the deck
   ========================================================================= */
const ROOM_HANDOFF_KEY = 'eoo_room_handoff';
const roomHandoff = (()=>{
  try{
    const fresh = localStorage.getItem(ROOM_HANDOFF_KEY);
    if(fresh){ localStorage.removeItem(ROOM_HANDOFF_KEY); sessionStorage.setItem(ROOM_HANDOFF_KEY, fresh); }
    const raw = sessionStorage.getItem(ROOM_HANDOFF_KEY);
    if(!raw) return null;
    const h = JSON.parse(raw);
    if(!h || !h.deck || Date.now() - (h.at||0) > 60*60*1000){ sessionStorage.removeItem(ROOM_HANDOFF_KEY); return null; }
    return h;
  }catch(e){ return null; }
})();
if(roomHandoff){
  const note = document.getElementById('signinHandoff');
  note.textContent = roomHandoff.mode==='join'
    ? `Sign in to join room ${String(roomHandoff.code||'').toUpperCase()} with "${roomHandoff.deck.name||'your deck'}".`
    : `Sign in to open a new room${roomHandoff.boardName ? ` on "${roomHandoff.boardName}"` : ''} with "${roomHandoff.deck.name||'your deck'}".`;
  note.style.display = '';
}
/* ---- Direct board link: room.html?board=<game folder id> opens a new room
   on that game's newest board layout (the same .json files the deckbuilder's
   "Send deck to room" offers — see getPrecons in Code.gs), read fresh from
   the game folder after sign-in. The link is used once: it's taken off the
   address bar, so a refresh rejoins the room instead of opening another. */
const boardLinkGameId = (()=>{ try{ return new URLSearchParams(location.search).get('board') || ''; }catch(e){ return ''; } })();
if(boardLinkGameId && !roomHandoff){
  const note = document.getElementById('signinHandoff');
  note.textContent = 'Sign in to open a new room with this game\'s board.';
  note.style.display = '';
}
function fetchGameBoards(gameId){ return roomServices.fetchGameBoards(gameId); }
async function startFromBoardLink(gameId){
  try{ history.replaceState(null, '', location.pathname); }catch(e){}
  toast('Loading the board…');
  let res;
  try{ res = await fetchGameBoards(gameId); }
  catch(err){ res = { ok:false, error: err.message }; }
  const boards = (res && res.ok && res.boards) ? res.boards.slice() : [];
  if(!boards.length){
    document.getElementById('setup-screen').classList.remove('hidden');
    toast(res && !res.ok ? `Could not load the board: ${res.error}` : 'That game has no board layout in its folder yet.');
    return;
  }
  boards.sort((a,b)=> String(b.updated||'').localeCompare(String(a.updated||''))); // newest first
  startFromHandoff({ mode:'new', board: boards[0].layout, boardName: boards[0].name, deck: null, gameFolderId: gameId });
}
async function startFromHandoff(h){
  try{ sessionStorage.removeItem(ROOM_HANDOFF_KEY); }catch(e){}
  enterGameScreen();
  if(h.mode==='join'){
    connectToRoom({code: String(h.code||'').toUpperCase(), isHost:false});
    await waitForRoomState();
    fitAll();
    await placeHandoffDeck(h.deck);
  } else {
    if(h.board){
      const b = h.board;
      doAction('LOAD_LAYOUT', { sourceSheets:b.sourceSheets||[], theme:b.theme||null, tokenTypes:b.tokenTypes||[], tokenTypeStyles:b.tokenTypeStyles||[],
        tabs:b.tabs||null, zones:b.zones||[], pieces:b.pieces||[], tokens:b.tokens||[], deckRecords:b.deckRecords||[],
        gameFolderId: h.gameFolderId || b.gameFolderId || '' });
    }
    fitAll();
    await placeHandoffDeck(h.deck);
    connectToRoom({code: randomId(6), isHost:true}); // the board + deck become the room's starting layout
  }
  fitAll();
}
// Joining: the room's current table arrives as a STATE_SNAPSHOT from whoever's
// there (possibly a few, a moment apart). Wait until they've settled — or a few
// seconds with no answer — so the deck isn't wiped by a snapshot landing late.
function waitForRoomState(){
  const started = Date.now();
  return new Promise(resolve=>{
    const tick = ()=>{
      const now = Date.now();
      if(state.lastSnapshotAt ? now - state.lastSnapshotAt > 900 : now - started > 4000) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });
}
// The deck goes in the first free spot near the middle of the table.
async function placeHandoffDeck(deck){
  if(!deck) return; // a board link brings no deck
  const b = boardBounds();
  const cx = (b.minX+b.maxX)/2 - PIECE_W/2, cy = (b.minY+b.maxY)/2 - PIECE_H/2;
  const stepX = PIECE_W + 24, stepY = PIECE_H + 24;
  const free = (x, y)=> ![...state.pieces.values()].some(p=>{
    if(!onCurrentTab(p)) return false;
    const r = pieceBounds(p);
    return x < r.x + r.w && x + PIECE_W > r.x && y < r.y + r.h && y + PIECE_H > r.y;
  });
  let spot = {x:cx, y:cy};
  search: for(let ring=0; ring<8; ring++){
    for(let dy=-ring; dy<=ring; dy++) for(let dx=-ring; dx<=ring; dx++){
      if(Math.max(Math.abs(dx), Math.abs(dy))!==ring) continue;
      const x = cx + dx*stepX, y = cy + dy*stepY;
      if(free(x, y)){ spot = {x, y}; break search; }
    }
  }
  const at = snapPos(spot.x, spot.y, PIECE_W, PIECE_H);
  try{ await importDeckJson(deck, at.x, at.y); }
  catch(err){ toast('Could not place your deck: ' + err.message); }
}

// Asks the room's other players (if any) for the current board so a new
// joiner isn't stuck staring at an empty table. If nobody answers within a
// couple seconds (first to arrive, or everyone else has left), the local —
// already-cleared — board is simply treated as current from here on.
function requestStateSync(){
  doAction('REQUEST_STATE', {requesterId: state.playerId});
  setTimeout(()=>{ state.hasInitialState = true; }, 2000);
}

let connectMode = 'host';
document.getElementById('connectTabs').addEventListener('click', (e)=>{
  const t = e.target.closest('.tab'); if(!t) return;
  connectMode = t.dataset.mode;
  document.querySelectorAll('#connectTabs .tab').forEach(x=>x.classList.toggle('active', x===t));
  document.getElementById('connectHostRow').style.display = connectMode==='host' ? 'block':'none';
  document.getElementById('connectJoinRow').style.display = connectMode==='join' ? 'block':'none';
  document.getElementById('connectModalTitle').textContent = connectMode==='host' ? 'Open this room' : 'Join a room';
});
function openConnectModal(mode){
  document.getElementById('connectError').textContent = '';
  document.getElementById('connectJoinCodeInput').value = '';
  document.getElementById('connectTabs').querySelector(`[data-mode="${mode}"]`).click();
  document.getElementById('connectModal').classList.remove('hidden');
}
document.getElementById('btnOpenRoom').addEventListener('click', ()=> openConnectModal('host'));
document.getElementById('btnJoinRoom').addEventListener('click', ()=> openConnectModal('join'));
document.getElementById('btnConnectGo').addEventListener('click', ()=>{
  const err = document.getElementById('connectError');
  err.textContent = '';
  const isHost = connectMode==='host';
  let code = isHost ? randomId(6) : document.getElementById('connectJoinCodeInput').value.trim().toUpperCase();
  if(!code){ err.textContent = 'Enter a session code.'; return; }
  const hasLocalContent = state.pieces.size>0 || state.tokens.size>0 || state.zones.size>0;
  if(!isHost && hasLocalContent){
    if(!confirm('Joining will replace your current solo board with the room\'s shared board. Continue?')) return;
  }
  document.getElementById('connectModal').classList.add('hidden');
  connectToRoom({code, isHost});
});
