/* =========================================================================
   GAMES — picking which game to open, and switching between them. Whatever start
   screen the build uses (see cardSource.start) ends up in startWithGames().
   ========================================================================= */
// The start screen (whatever the build uses — see cardSource.start) calls this once it knows which games this person can open.
function startWithGames(games){
  state.games = games;
  document.getElementById('btnChangeGame').style.display = games.length>1 ? 'inline-flex' : 'none';
  if(games.length===1){
    selectGame(games[0]);
  } else {
    // The start screen has to come down FIRST: the game-select modal sits at a lower
    // z-index than it, so it would otherwise be fully rendered but invisibly stuck
    // underneath (exactly what "gets stuck checking access" once looked like).
    hideStartScreen();
    // More than one game available — ask every time, rather than silently
    // remembering the last choice, so switching is never surprising.
    openGameSelectModal(selectGame);
  }
}
function hideStartScreen(){ cardSource.hideStartScreen(); }

// First-ever game pick after start-up: just loads it, nothing to reset yet.
function selectGame(game){
  state.currentGameFolderId = game.folderId;
  state.currentGameLabel = game.label;
  state.authorizedSets = game.sets;
  hideStartScreen();
  // #app stays display:none (see its CSS) until a game is actually chosen, so nothing
  // game-flavored — tabs, deck-setup slots, branding — is visible behind the
  // game-select modal or the sign-in gate before this point.
  document.getElementById('app').classList.add('game-active');
  loadData(false);
  fetchHelpArticles().catch(()=>{}); // warm the cache early so opening Help later feels instant
}

// Resets every piece of state that's specific to a particular game's card pool —
// used when switching games mid-session so the new game starts from a clean slate,
// exactly as if it had just been signed into fresh.
function resetGameSpecificState(){
  state.cards = []; state.byId = new Map(); state.headers = []; state.hasImages = false; state.fieldDefs = [];
  state.game = defaultGame();
  freshDeckState();
  state.selection = new Set();
  state.lastClickIndex = null;
  state.visibleCardsOrder = [];
  state.flippedCards = new Set();
  state.genericBacks = {};
  state.genericBackUrl = '';
  state.pcio = {found:false};
  state.precons = {canEdit:false, decks:[], boards:[]};
  applyPreconUI();
  applyPcioUI(); // reset all three playingcards.io-flavored UI bits until the new game's loadData() re-evaluates them
}

// Switching games mid-session, via the "Game" button — deliberately clears all
// current deckbuilding progress (the person is warned and confirms before this is
// ever called; see the btnChangeGame handler below).
function applyGameChange(game){
  if(game.folderId === state.currentGameFolderId) return; // reselected the same game — nothing to do
  state.currentGameFolderId = game.folderId;
  state.currentGameLabel = game.label;
  state.authorizedSets = game.sets;
  resetGameSpecificState();
  loadData(false);
  fetchHelpArticles().catch(()=>{}); // warm the cache for the newly-selected game's own help content
}

function renderGameSelectList(onPick){
  const el = document.getElementById('gameSelectList');
  el.innerHTML = state.games.map(g=>
    `<div class="row-item" data-game="${escapeHtml(g.folderId)}">
       <span>${escapeHtml(g.label)}</span>
       <span style="font-size:12px;color:var(--text-soft);">${g.sets.length} set${g.sets.length!==1?'s':''}</span>
     </div>`
  ).join('');
  el.querySelectorAll('[data-game]').forEach(row=>{
    row.addEventListener('click', ()=>{
      document.getElementById('gameSelectModal').classList.add('hidden');
      onPick(state.games.find(g=>g.folderId===row.dataset.game));
    });
  });
}
function openGameSelectModal(onPick){
  renderGameSelectList(onPick);
  document.getElementById('gameSelectModal').classList.remove('hidden');
}
document.getElementById('btnChangeGame').addEventListener('click', ()=>{
  if(state.games.length<2){ toast('Only one game is available to your account.'); return; }
  if(!confirm('Change game? This clears your current deckbuilding progress — unsaved changes will be lost (anything you already Saved stays saved, per-game).')) return;
  openGameSelectModal(applyGameChange);
});
