/* =========================================================================
   SIGN-IN — gates the whole app, same as the deckbuilder. Unlike the
   deckbuilder, there's no fixed list of "sets this account can see" to fetch
   up front (a room isn't tied to any one game or set) — access is instead
   checked per-sheet, lazily, the moment a card from that sheet is actually
   needed (see fetchSheetCards -> Code.gs's getCardsBySheetId). So this gate's
   only job is to make sure a real Google identity exists before letting
   anyone past it; state.idToken is what actually gets checked, every time,
   server-side.
   ========================================================================= */
function showSigninGate(){ document.getElementById('signin-gate').classList.remove('hidden'); }
function hideSigninGate(){ document.getElementById('signin-gate').classList.add('hidden'); }
function setSigninStatus(s){ document.getElementById('signinStatus').textContent = s; }
function setSigninChecking(isChecking){ document.getElementById('signinSpinner').style.display = isChecking ? 'block' : 'none'; }
function setSigninError(s){ document.getElementById('signinError').textContent = s; }

// The GIS script tag is loaded with async, so it's a race against this inline
// script — poll briefly for window.google rather than failing on the first check.
function initGoogleSignIn(attempt){
  attempt = attempt || 0;
  if(!window.google || !google.accounts || !google.accounts.id){
    if(attempt < 100){ // up to ~10s total, checked every 100ms
      setTimeout(()=>initGoogleSignIn(attempt+1), 100);
      return;
    }
    setSigninError('Could not load Google Sign-In. Check your connection and reload — if this keeps happening, an ad/tracker blocker may be blocking accounts.google.com.');
    return;
  }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleSignIn });
  google.accounts.id.renderButton(document.getElementById('googleSignInButton'), {
    theme: 'outline', size: 'large', text: 'signin_with', width: 280,
  });
  google.accounts.id.prompt(); // offers One Tap for a returning, already-Google-signed-in user
}

// Reads the account's name/email straight off the ID token's payload, purely
// to prefill "Playing as" — this is NOT the access check (that's server-side,
// against the raw token itself, every time a sheet is fetched), just display.
function decodeIdTokenPayload(idToken){
  try{
    const b64 = idToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const json = decodeURIComponent(atob(b64).split('').map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join(''));
    return JSON.parse(json);
  }catch(e){ return {}; }
}

function onGoogleSignIn(response){
  setSigninError('');
  setSigninChecking(true);
  const payload = decodeIdTokenPayload(response.credential);
  state.idToken = response.credential;
  state.userEmail = payload.email || '';
  const name = payload.name || payload.email || 'Player';
  setSigninChecking(false);
  hideSigninGate();
  startRoom({ name, label: name + (state.userEmail ? ` (${state.userEmail})` : '') });
}

initGoogleSignIn();
