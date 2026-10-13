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
    warmBackend();
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
    auto_select: true, // a returning, already-consented person is signed straight in, no One Tap click
  });
  perfMark('sign-in ready');
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
    return await cardSource.whoAmI(idToken);
  }catch(firstErr){
    setSigninStatus('Still checking your access — retrying…');
    try{
      return await cardSource.whoAmI(idToken);
    }catch(secondErr){
      throw secondErr;
    }
  }
}

// An ungated do-nothing request, sent as soon as the page loads, so the Apps Script server
// is already awake (no cold start) by the time the person finishes signing in.
function warmBackend(){
  try{ fetch(WEBAPP_URL + '?ping=1&_=' + Date.now(), { mode:'no-cors' }).catch(()=>{}); }catch(e){}
}

// After the saved-cards fast path below: confirms with the server (in the background) that this
// account still has access, and refreshes the saved list of games/sets. Anything the server says
// that differs from what we assumed wins.
async function confirmAccessInBackground(credential, assumedGames){
  try{
    const who = await fetchWhoAmIWithRetry(credential);
    perfMark('access confirmed by server');
    if(!who.games || !who.games.length){
      cardCacheClear();
      signOut();
      setSigninError(`Signed in as ${who.email}, but that account doesn't have access to any card sets yet.`);
      noAccessEmail = who.email;
      showSigninRequestAccess(true);
      return;
    }
    state.userEmail = who.email;
    document.getElementById('signinAccountLine').textContent = who.email;
    cardCacheSaveGames(who.email, who.games);
    state.games = who.games;
    initFeedbackAdmin();
    if(typeof initCardUpload==='function') initCardUpload();
    const fresh = who.games.find(g=>g.folderId===state.currentGameFolderId);
    if(!fresh){
      toast('Your game access changed — please sign in again.');
      cardCacheClear();
      signOut();
      return;
    }
    const sameSets = JSON.stringify(fresh.sets.map(s=>s.folderId)) === JSON.stringify(state.authorizedSets.map(s=>s.folderId));
    if(!sameSets){
      state.authorizedSets = fresh.sets;
      toast('Your set access changed — refreshing cards.');
      loadData(true);
    }
  }catch(e){
    console.error('Background access check failed:', e);
    toast('Could not confirm your access with the server yet — showing saved cards. ' + e.message);
  }
}

async function onGoogleSignIn(response){
  perfMark('Google sign-in credential received');
  setSigninError('');
  showSigninRequestAccess(false);
  setSigninStatus('Checking your access…');
  setSigninChecking(true);
  try{
    // Return visit: this browser already holds this account's saved game/set list. Start
    // from it now and let the server confirm in the background (see confirmAccessInBackground).
    const guessedEmail = emailFromCredential(response.credential);
    const savedGames = cardCacheLoadGames(guessedEmail);
    if(savedGames){
      state.idToken = response.credential;
      state.userEmail = guessedEmail;
      localStorage.setItem(LS_LAST_EMAIL_KEY, guessedEmail);
      document.getElementById('signinAccountLine').textContent = guessedEmail;
      document.getElementById('signinAccountLine').title = guessedEmail + ' — click to sign out';
      setSigninStatus('');
      setSigninChecking(false);
      perfMark('using saved access list');
      startWithGames(savedGames);
      confirmAccessInBackground(response.credential, savedGames);
      return;
    }
    const who = await fetchWhoAmIWithRetry(response.credential);
    perfMark('access check finished');
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
    localStorage.setItem(LS_LAST_EMAIL_KEY, who.email);
    document.getElementById('signinAccountLine').textContent = who.email;
    document.getElementById('signinAccountLine').title = who.email + ' — click to sign out';
    setSigninStatus('');
    setSigninChecking(false);

    cardCacheSaveGames(who.email, who.games);
    startWithGames(who.games);
    initFeedbackAdmin();
    if(typeof initCardUpload==='function') initCardUpload();
  }catch(e){
    setSigninStatus('');
    setSigninChecking(false);
    setSigninError('Sign-in failed: ' + e.message);
  }
}

function signOut(){
  initFeedbackAdmin(true);
  if(typeof initCardUpload==='function') initCardUpload(true);
  cardCacheClear();
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

