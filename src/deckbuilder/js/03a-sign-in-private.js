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
    localStorage.setItem(LS_LAST_EMAIL_KEY, who.email);
    document.getElementById('signinAccountLine').textContent = who.email;
    document.getElementById('signinAccountLine').title = who.email + ' — click to sign out';
    setSigninStatus('');
    setSigninChecking(false);

    startWithGames(who.games);
    initFeedbackAdmin();
  }catch(e){
    setSigninStatus('');
    setSigninChecking(false);
    setSigninError('Sign-in failed: ' + e.message);
  }
}

function signOut(){
  initFeedbackAdmin(true);
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

