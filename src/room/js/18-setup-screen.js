/* =========================================================================
   SETUP SCREEN — by default you enter a room with no connection to any
   spreadsheet at all: just a name, straight onto an empty local board. Build
   out your layout in peace, then open it up to others (Open Room) or join
   someone else's table (Join Room) from the toolbar whenever you're ready.
   The "rejoining an existing room" fields below are just a shortcut for
   connecting immediately, for a player coming back to a session they were
   already in.
   ========================================================================= */
const LS_LAST_SESSION_CODE_KEY = 'eoo_room_last_session';

let setupMode = 'host';
document.getElementById('sessionTabs').addEventListener('click', (e)=>{
  const t = e.target.closest('.tab'); if(!t) return;
  setupMode = t.dataset.mode;
  document.querySelectorAll('#sessionTabs .tab').forEach(x=>x.classList.toggle('active', x===t));
  document.getElementById('hostRow').style.display = setupMode==='host' ? 'block':'none';
  document.getElementById('joinRow').style.display = setupMode==='join' ? 'block':'none';
});
document.getElementById('btnToggleRejoin').addEventListener('click', ()=>{
  document.getElementById('rejoinFields').classList.toggle('hidden');
});

const rememberedSessionCode = localStorage.getItem(LS_LAST_SESSION_CODE_KEY);
if(rememberedSessionCode){
  // A remembered session code strongly suggests this is a RECONNECT (refresh, or
  // came back later) rather than a brand new game — surface and pre-fill the
  // rejoin fields on Join, rather than leaving them collapsed and hidden.
  document.getElementById('rejoinFields').classList.remove('hidden');
  document.getElementById('joinCodeInput').value = rememberedSessionCode;
  document.getElementById('sessionTabs').querySelector('[data-mode="join"]').click();
}

// Shared bootstrapping for showing the board once a name is set, whether
// entering solo or connecting immediately via the rejoin shortcut.
function enterGameScreen(){
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.add('active');
  updateConnectionUI();
  fitAll();
  applyRotation();
  initHandScale();
  initGridDisplay();
  applyBoardTheme(state.theme);
  renderBoard();
  renderHand();
  renderPlayerCounters();
  renderTurnTracker();
}
function updateConnectionUI(){
  const connected = isConnected();
  document.getElementById('sessionInfo').textContent = connected
    ? `Session ${state.sessionCode} — ${state.playerName}`
    : `Playing solo — ${state.playerName}`;
  document.getElementById('connStatus').style.display = connected ? '' : 'none';
  document.getElementById('btnOpenRoom').style.display = connected ? 'none' : '';
  document.getElementById('btnJoinRoom').style.display = connected ? 'none' : '';
}

document.getElementById('btnEnterRoom').addEventListener('click', async ()=>{
  const err = document.getElementById('setupError');
  err.textContent = '';
  // state.playerName is already set by the start screen (see startRoom) by the
  // time this screen is even reachable.

  const rejoinOpen = !document.getElementById('rejoinFields').classList.contains('hidden');
  if(!rejoinOpen){
    // The default path: straight onto an empty local board, no sync at all yet.
    enterGameScreen();
    return;
  }
  let code = setupMode==='host' ? randomId(6) : document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if(!code){ err.textContent = 'Enter a session code.'; return; }
  enterGameScreen();
  connectToRoom({code, isHost: setupMode==='host'});
});

