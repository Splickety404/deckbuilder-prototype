/* =========================================================================
   CARD SOURCE (private build) — every call the deckbuilder makes to a card
   backend goes through `cardSource`, never straight to a URL, so another build
   can supply its own object with the same methods and nothing else changes:
     whoAmI(idToken)                    who is signed in + which games/sets they can open
     loadSet(folderId, fast)            one set's rows + art (fast skips the art scan)
     loadSetImages(folderId)            the slower art-link catch-up for one set
     loadGameAssets(gameFolderId)       card backs + board file shared by a whole game
     loadHelp(folderId)                 the game's help articles
     cardHistory(cardId)                past versions of one card
     precons(gameFolderId)              preconstructed decks + boards
     savePrecon(fileId, deck, replace)  add/replace a preconstructed deck
     submitAccessRequest(game, set, email, note)
     start() / hideStartScreen()        show the start screen, which ends in startWithGames(games) / take it down
     sizedUrl(url, width, force) / noteSmallImage(url, smallUrl)   how this host resizes art / which small copies exist
   This is the Google Apps Script / Drive implementation — unchanged behavior,
   moved here from the files that used to hold each function. */
// A plain fetch() can hang indefinitely if the Apps Script endpoint itself is slow or
// stuck (it does NOT reject just because the server is taking a long time) — so every
// call here races the fetch against an AbortController timeout, guaranteeing we fall
// through to the JSONP fallback (and eventually a visible error) instead of leaving the
// UI stuck on "Checking your access…"/"loading card data…" forever with nothing to show
// for it.
async function fetchWithTimeout(url, ms){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), ms);
  try{
    const res = await fetch(url, {signal: controller.signal});
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Fetches one authorized set's data given its root folder id — the server checks this
// signed-in user's live Drive permission on that folder before returning anything.
// `fast`: skips the server's live Drive art-folder scan so this returns as soon as the
// sheet itself can be read, using whatever image URLs are already sitting in it from
// the last sync — see fetchSetImages() below for the slower follow-up that catches
// those URLs up in the background, without blocking on card text.
async function fetchSetData(folderId, fast){
  const url = `${WEBAPP_URL}?scanSet=${encodeURIComponent(folderId)}&idToken=${encodeURIComponent(state.idToken)}${fast?'&fast=1':''}`;
  let result;
  try{
    result = await fetchWithTimeout(url + '&_=' + Date.now(), 20000);
  }catch(fetchErr){
    result = await new Promise((resolve,reject)=>{
      const cbName = '__eooSetCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to respond scanning that set. It may need to be redeployed as a new version, or Drive is just being slow — try again in a moment.')); }, 30000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
  if(!result.ok) throw new Error(result.error || 'Unknown error scanning that folder.');
  return result; // {ok:true, setName, sheetId, rows, genericBackUrl, genericBacks, pcio}
}

// The slow half a fast=true fetchSetData() skipped: runs that set's live Drive
// art-folder scan and returns just the resulting id/front-image-url/back-image-url
// triples (not full row data — the caller already has everything else). Meant to be
// called once per set, right after that set's fast card data has already rendered.
async function fetchSetImages(folderId){
  const url = `${WEBAPP_URL}?syncSetImages=${encodeURIComponent(folderId)}&idToken=${encodeURIComponent(state.idToken)}`;
  let result;
  try{
    result = await fetchWithTimeout(url + '&_=' + Date.now(), 30000);
  }catch(fetchErr){
    result = await new Promise((resolve,reject)=>{
      const cbName = '__eooImgCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to sync art for that set.')); }, 45000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
  if(!result.ok) throw new Error(result.error || 'Unknown error syncing art for that set.');
  return result; // {ok:true, sheetId, images:[{id,'front-image-url','back-image-url'}, ...]}
}

// Game-level assets (card backs, the .pcio board file) — see the gameAssets endpoint
// in Code.gs. A fast=true fetchSetData() skips these too (same live-Drive-folder-scan
// cost as art), so this is called once per GAME (not once per set within it — every
// set in a game shares the same assets) to catch them up in the background.
async function fetchGameAssets(gameFolderId){
  const url = `${WEBAPP_URL}?gameAssets=${encodeURIComponent(gameFolderId)}&idToken=${encodeURIComponent(state.idToken)}`;
  let result;
  try{
    result = await fetchWithTimeout(url + '&_=' + Date.now(), 20000);
  }catch(fetchErr){
    result = await new Promise((resolve,reject)=>{
      const cbName = '__eooAssetsCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to load this game\'s shared assets.')); }, 30000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
  if(!result.ok) throw new Error(result.error || 'Unknown error loading this game\'s assets.');
  return result; // {ok:true, genericBackUrl, overlordBackUrl, schemeBackUrl, championBackUrl, pcio}
}

// Asks the server who this ID token belongs to, and which GAMES (each with only the
// sets within it) that email currently has live Drive access to at least one set of.
// This is the ONLY place the list of available games/sets comes from — nothing about
// either is ever stored client-side. Returns {ok:true, email, games:[{folderId,label,sets:[{folderId,label}]}]}.
async function fetchWhoAmI(idToken){
  const url = `${WEBAPP_URL}?whoami=1&idToken=${encodeURIComponent(idToken)}`;
  let result;
  try{
    result = await fetchWithTimeout(url + '&_=' + Date.now(), 20000);
  }catch(fetchErr){
    result = await new Promise((resolve,reject)=>{
      const cbName = '__eooWhoCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to check your access. It may need to be redeployed as a new version, or Drive is just being slow — try again in a moment.')); }, 30000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
  if(!result.ok) throw new Error(result.error || 'Could not verify your sign-in.');
  return result; // {ok:true, email, games:[{folderId,label,sets:[{folderId,label}]}]}
}

// Same fetch-with-timeout-then-JSONP-fallback shape as fetchWhoAmI/fetchSetData/etc
// above — this endpoint is UNGATED (no idToken), so it works even for someone who
// isn't signed in to anything yet.
async function submitAccessRequest(game, setName, email, note){
  const url = `${WEBAPP_URL}?requestAccess=1&game=${encodeURIComponent(game)}&set=${encodeURIComponent(setName)}&email=${encodeURIComponent(email)}&note=${encodeURIComponent(note)}`;
  let result;
  try{
    result = await fetchWithTimeout(url + '&_=' + Date.now(), 20000);
  }catch(fetchErr){
    result = await new Promise((resolve,reject)=>{
      const cbName = '__eooReqAccessCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to send that request. Try again in a moment.')); }, 30000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
  if(!result.ok) throw new Error(result.error || 'Unknown error sending that request.');
  return result;
}

async function fetchCardHistory(cardId){
  // The card's own set sheet: each set keeps its own change history. A card
  // that's no longer in any set (removed) could be from any of them, so
  // every loaded set is asked.
  const card = state.byId.get(cardId);
  const sheetIds = card ? [card._sheetId] : [...new Set(state.cards.map(c=> c._sheetId))];
  const list = sheetIds.filter(Boolean).join(',');
  const sheetParam = list ? `&sheetId=${encodeURIComponent(list)}` : '';
  const url = `${WEBAPP_URL}?cardHistory=${encodeURIComponent(cardId)}&idToken=${encodeURIComponent(state.idToken)}${sheetParam}`;
  try{
    const res = await fetch(url + '&_=' + Date.now());
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }catch(fetchErr){
    // Same fetch-then-JSONP fallback as the main card feed — this endpoint is
    // subject to the same occasional cross-origin quirks.
    return await new Promise((resolve,reject)=>{
      const cbName = '__eooHistCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('JSONP timed out')); }, 15000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
}

async function fetchPrecons(gameFolderId){
  const url = `${WEBAPP_URL}?precons=${encodeURIComponent(gameFolderId)}&idToken=${encodeURIComponent(state.idToken)}`;
  let result;
  try{
    result = await fetchWithTimeout(url + '&_=' + Date.now(), 30000);
  }catch(fetchErr){
    result = await new Promise((resolve,reject)=>{
      const cbName = '__eooPreconCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('The server took too long to list preconstructed decks.')); }, 40000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${url}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
  if(!result.ok) throw new Error(result.error || 'Could not list preconstructed decks.');
  return result; // {ok, canEdit, decks:[{fileId, fileName, name, updated, deck, missing:[ids]}]}
}

// Fetches the game's help articles from the server (the caching/retry wrapper lives in fetchHelpArticles).
async function fetchHelpFromServer(folderId){
  try{
    const res = await fetch(`${WEBAPP_URL}?help=1&folderId=${encodeURIComponent(folderId)}&_=${Date.now()}`);
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }catch(fetchErr){
    return await new Promise((resolve,reject)=>{
      const cbName = '__eooHelpCb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('JSONP timed out')); }, 15000);
      function cleanup(){ clearTimeout(timer); delete window[cbName]; script.remove(); }
      window[cbName] = (data)=>{ cleanup(); resolve(data); };
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP script failed to load')); };
      script.src = `${WEBAPP_URL}?help=1&folderId=${encodeURIComponent(folderId)}&callback=${cbName}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
  }
}

// Saves (or replaces) one preconstructed deck file in the game's folder; throws on any failure.
async function savePreconToServer(fileId, deck, replace){
  const res = await fetch(WEBAPP_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({ action:'precSave', idToken: state.idToken, gameFolderId: state.currentGameFolderId, fileId, deck, replace }) });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if(!j.ok) throw new Error(j.error || 'Unknown error');
  return j;
}

// Google's image CDN accepts a =w{pixels} size suffix on lh3.googleusercontent.com
// links, so we can request an appropriately-sized render instead of always pulling the
// full source resolution — dramatically cuts load time (and, for the PDF export, file
// size) for a card sourced from a PDF, where that "render" is the only way to get a
// viewable image out of it at all in the first place. But for a card whose art is
// already a standalone PNG/JPEG, asking for one more exact pixel width forces Google's
// CDN to dynamically resize it on request instead of just serving the file as-is —
// real, easy-to-notice latency (especially on hover, where the preview needs a
// different width than whatever the grid thumbnail already asked for) bought for very
// little, since these aren't a page pulled out of some huge multi-card PDF. Code.gs's
// artUrl() tags every URL it hands back with a "#img-src" or "#pdf-src" fragment
// (inert — never sent to the browser's actual request, just text this function reads
// off the string) saying which case it is, so only a URL NOT tagged as a plain image
// (a PDF, or anything untagged/legacy from before this existed) gets sized down; an
// image URL is returned as-is, fragment stripped, requesting the file at its own
// native size.
//
// The PDF export is the one caller that always wants the `force` override: it
// deliberately downsizes to a fixed print resolution (900px wide) no matter the
// source format, both to cap file size and because a native-resolution PNG can be
// print-production scale — large enough that fetching/decoding it client-side is
// what was actually failing PDF export for PNG-sourced cards. `force` skips the
// "leave images alone" branch above and always appends the width, same as a PDF.
// Cards published by the Card Updater also have a small copy of their art
// (375 px wide, a third of the download). Known small copies, by full-size link:
// whenever a picture is wanted at small-copy size or less, the small one is used.
// Cards without one (every older card) are unaffected.
const smallImageFor = new Map();
const SMALL_IMAGE_MAX_WIDTH = 400;
function driveNoteSmallImage(url, smallUrl){
  const sm = String(smallUrl||'').trim();
  if(url && sm) smallImageFor.set(url, sm);
}
function driveSizedUrl(url, w, force){
  if(!url) return '';
  if(!force && w <= SMALL_IMAGE_MAX_WIDTH && smallImageFor.has(url)) url = smallImageFor.get(url);
  const isImage = !force && url.includes('#img-src');
  const base = url.split('#')[0]; // e.g. ".../d/<fileId>" or ".../d/<fileId>?v=<token>" (see Code.gs artUrl())
  if(isImage) return base;
  // The "=wNNN" size directive has to sit directly after the fileId, BEFORE any
  // "?v=..." cache-busting query string Code.gs's artUrl() may have added — Google's
  // CDN only recognizes it as a path suffix, not as part of a query string. So it's
  // inserted right before the "?", not just appended to the end of the string.
  const qIdx = base.indexOf('?');
  return qIdx === -1 ? (base + '=w' + w) : (base.slice(0, qIdx) + '=w' + w + base.slice(qIdx));
}

const cardSource = {
  whoAmI: fetchWhoAmI,
  loadSet: fetchSetData,
  loadSetImages: fetchSetImages,
  loadGameAssets: async (gameFolderId)=>{
    const a = await fetchGameAssets(gameFolderId);
    return {
      genericBackUrl: a.genericBackUrl,
      genericBacks: { overlordBackUrl: a.overlordBackUrl || '', schemeBackUrl: a.schemeBackUrl || '', championBackUrl: a.championBackUrl || '' },
      pcio: a.pcio,
    };
  },
  loadHelp: fetchHelpFromServer,
  cardHistory: fetchCardHistory,
  precons: fetchPrecons,
  savePrecon: savePreconToServer,
  submitAccessRequest: submitAccessRequest,
  // Start-up: the Google sign-in gate. It ends by calling startWithGames(games) (see onGoogleSignIn).
  start: ()=> initGoogleSignIn(),
  hideStartScreen: ()=> hideSigninGate(),
  sizedUrl: driveSizedUrl,
  noteSmallImage: driveNoteSmallImage,
};
