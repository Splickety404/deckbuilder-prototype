/* =========================================================================
   SIGN-IN — Google Identity Services gates the whole app. Nothing loads until
   the server has verified an ID token and told us which sets that account may see.
   ========================================================================= */
const LS_LAST_EMAIL_KEY = 'eoo_last_signed_in_email'; // display-only, purely cosmetic (shown briefly before the button renders) — never used for access control
function showSigninGate(){ document.getElementById('signin-gate').classList.remove('hidden'); }
function hideSigninGate(){ document.getElementById('signin-gate').classList.add('hidden'); }
function setSigninStatus(s){ document.getElementById('signinStatus').textContent = s; }
function setSigninChecking(isChecking){ document.getElementById('signinSpinner').style.display = isChecking ? 'block' : 'none'; }
function setSigninError(s){ document.getElementById('signinError').textContent = s; }

// The GIS script tag is loaded with async, so it's a race against this inline script —
// on a slow connection (or just most of the time), window.google isn't defined yet by
// the time this runs. Poll for it briefly instead of failing on the first check.
function initGoogleSignIn(attempt){
  attempt = attempt || 0;
  if(attempt === 0){
    const remembered = localStorage.getItem(LS_LAST_EMAIL_KEY);
    if(remembered) setSigninStatus(`Last signed in as ${remembered}`);
  }
  if(!window.google || !google.accounts || !google.accounts.id){
    if(attempt < 100){ // up to ~10s total, checked every 100ms
      setTimeout(()=>initGoogleSignIn(attempt+1), 100);
      return;
    }
    setSigninError('Could not load Google Sign-In. Check your connection and reload — if this keeps happening, an ad/tracker blocker may be blocking accounts.google.com.');
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: onGoogleSignIn,
  });
  google.accounts.id.renderButton(document.getElementById('googleSignInButton'), {
    theme: 'outline', size: 'large', text: 'signin_with', width: 280,
  });
  google.accounts.id.prompt(); // offers One Tap for a returning, already-Google-signed-in user
}

// A single fetchWhoAmI failure (timeout, transient Drive hiccup, Apps Script
// cold-start) is usually a one-off — retrying it once, silently, clears up most of
// the "occasional sign-in failure" reports without the person having to notice
// anything went wrong or click Sign In a second time themselves.
async function fetchWhoAmIWithRetry(idToken){
  try{
    return await fetchWhoAmI(idToken);
  }catch(firstErr){
    setSigninStatus('Still checking your access — retrying…');
    try{
      return await fetchWhoAmI(idToken);
    }catch(secondErr){
      throw secondErr;
    }
  }
}

async function onGoogleSignIn(response){
  setSigninError('');
  showSigninRequestAccess(false);
  setSigninStatus('Checking your access…');
  setSigninChecking(true);
  try{
    const who = await fetchWhoAmIWithRetry(response.credential);
    if(!who.games || !who.games.length){
      setSigninStatus('');
      setSigninChecking(false);
      setSigninError(`Signed in as ${who.email}, but that account doesn't have access to any card sets yet.`);
      noAccessEmail = who.email;
      showSigninRequestAccess(true);
      return;
    }
    state.idToken = response.credential;
    state.userEmail = who.email;
    state.games = who.games;
    localStorage.setItem(LS_LAST_EMAIL_KEY, who.email);
    document.getElementById('signinAccountLine').textContent = who.email;
    document.getElementById('signinAccountLine').title = who.email + ' — click to sign out';
    document.getElementById('btnChangeGame').style.display = who.games.length>1 ? 'inline-flex' : 'none';
    setSigninStatus('');
    setSigninChecking(false);

    if(who.games.length===1){
      selectGame(who.games[0]);
    } else {
      // selectGame() (called when the user picks from the modal below) hides the
      // sign-in gate itself, but that's too late here: with more than one game, the
      // gate has to come down FIRST so the game-select modal — which sits at a lower
      // z-index than the gate — is actually visible and clickable, rather than being
      // fully rendered but invisibly stuck underneath the still-showing gate (exactly
      // what "gets stuck checking access" looked like: the modal was there the whole
      // time, just hidden behind the gate that never went away).
      hideSigninGate();
      // More than one game available — ask every time, rather than silently
      // remembering the last choice, so switching is never surprising.
      openGameSelectModal(selectGame);
    }
  }catch(e){
    setSigninStatus('');
    setSigninChecking(false);
    setSigninError('Sign-in failed: ' + e.message);
  }
}

// First-ever game pick after sign-in: just loads it, nothing to reset yet.
function selectGame(game){
  state.currentGameFolderId = game.folderId;
  state.currentGameLabel = game.label;
  state.authorizedSets = game.sets;
  hideSigninGate();
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
  state.isEchoMode = true;
  state.decks = { overlord: freshDeckSlot(), champion: freshDeckSlot(), generic: freshDeckSlot() };
  state.filtersByType = {
    overlord: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
    champion: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
    scheme: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
    generic: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
  };
  state.selection = new Set();
  state.lastClickIndex = null;
  state.visibleCardsOrder = [];
  state.flippedCards = new Set();
  state.genericBacks = { overlordBackUrl:'', schemeBackUrl:'', championBackUrl:'' };
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

function signOut(){
  state.idToken = '';
  state.userEmail = '';
  state.games = [];
  state.currentGameFolderId = '';
  state.currentGameLabel = '';
  state.authorizedSets = [];
  state.cards = [];
  state.byId = new Map();
  document.getElementById('btnChangeGame').style.display = 'none';
  if(window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  setSigninStatus('');
  setSigninError('');
  showSigninRequestAccess(false);
  showSigninGate();
}
document.getElementById('signinAccountLine').addEventListener('click', ()=>{
  if(confirm('Sign out of the deckbuilder?')) signOut();
});

