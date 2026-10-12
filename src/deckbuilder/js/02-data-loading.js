/* =========================================================================
   DATA LOADING
   ========================================================================= */
// Filters + tags a raw set of sheet rows into real card objects, exactly the same way
// regardless of which set they came from — reused for Set 1's own feed and for every
// additionally imported set, so behavior stays identical either way.
function processRawRows(rawRows, setName, sheetId, isEchoMode){
  const rows = rawRows.filter(r=>{
    if(!isEchoMode){
      // Generic mode has no fixed type-prefix convention to filter rows by — the only
      // required column for ANY game is "id", so that's the only hard requirement.
      return String(r.id||'').trim() !== '';
    }
    const t = (r.type||'').trim();
    if(!t) return false;
    // "C - Quest" cards are now used for the Champion's Quest-card slot — no longer
    // excluded. "Q - Quest" is kept excluded defensively in case that convention is
    // ever used for something unrelated.
    if(t.startsWith('Q - ')) return false;
    if(t.startsWith('Z - ')){
      // Z - Custom is still junk/reference-card clutter in general, EXCEPT the two
      // named placeholders standing in for the not-yet-created O - Stronghold /
      // C - Resistance cards. The moment real cards of those types exist, the pool
      // logic below prefers them automatically and these placeholders stop mattering.
      const isPlaceholder = t==='Z - Custom' && (r.name==='Resistance' || r.name==='Stronghold');
      if(!isPlaceholder) return false;
    }
    return true;
  });

  rows.forEach(r=>{
    // Kept unconditional (not Echo-only): everything downstream assumes these three
    // are always defined, trimmed strings — including generic-mode cards, whose sheet
    // may have no type/aspect/loyalty columns at all (they just come out as '').
    r.type = (r.type||'').trim();
    r.aspect = (r.aspect||'').trim();
    r.loyalty = (r.loyalty||'').trim();
    r._front = (r['front-image-url']||'').trim();
    r._back = (r['back-image-url']||'').trim();
    noteSmallImage(r._front, r['front-image-sm-url']);
    noteSmallImage(r._back, r['back-image-sm-url']);

    if(isEchoMode){
      r._doubleSided = String(r.is_double_sided).trim().toUpperCase()==='TRUE';
      r._isScheme = r.type==='O - Scheme';
      // These 4 are physically the same portrait-cut card as everything else, with
      // content printed sideways — same treatment as schemes: rotated on screen for
      // readability, printed at their native orientation (exports never rotate at all,
      // so nothing extra is needed there).
      r._isHorizontal = r._isScheme || HORIZONTAL_TYPES.has(r.type) ||
        (r.type==='Z - Custom' && Object.values(EXTRA_CARD_PLACEHOLDER_NAME).includes(r.name)); // the Stronghold/Resistance placeholders are horizontal too
      r._rotate = r._isHorizontal ? 90 : 0; // Echo mode always rotates its horizontal cards the same way it always has
    } else {
      // Generic mode: a required "is-double-sided" column (TRUE/FALSE) and a required
      // "rotate" column (0/90/180/270, defaulting to 0) — the data-driven equivalent
      // of Echo's hardcoded scheme/domination/stronghold rotation rules.
      r._doubleSided = String(r['is-double-sided']).trim().toUpperCase()==='TRUE';
      const rot = parseInt(r.rotate, 10);
      r._rotate = [90,180,270].includes(rot) ? rot : 0;
      r._isScheme = false;
      r._isHorizontal = (r._rotate===90 || r._rotate===270);
    }
    r._setName = setName;
    r._sheetId = sheetId; // carried into deck exports so the game room app can resolve cards without any sheet id hardcoded in its own source
  });
  return rows;
}

// Merges multiple sets' processed card lists into one, keeping exactly one entry per
// id. When the same id appears in more than one set, the card with the NEWER
// last-updated value wins (a missing/invalid last-updated loses to any real one) and
// becomes the displayed row (its own art, text, etc.) — but every set that id actually
// appeared under is still recorded on _setNames (see below), not just the winner's.
function mergeCardSets(setCardLists){
  const byId = new Map();
  const setNamesById = new Map(); // id -> Set of every _setName this id appears under, across ALL loaded sets — not just whichever copy "wins" as the displayed row
  setCardLists.forEach(cards=>{
    cards.forEach(card=>{
      if(!setNamesById.has(card.id)) setNamesById.set(card.id, new Set());
      setNamesById.get(card.id).add(card._setName);

      const existing = byId.get(card.id);
      if(!existing){ byId.set(card.id, card); return; }
      const existingDate = new Date(existing['last-updated']);
      const newDate = new Date(card['last-updated']);
      const existingValid = !isNaN(existingDate);
      const newValid = !isNaN(newDate);
      if(!existingValid || (newValid && newDate.getTime() >= existingDate.getTime())){
        byId.set(card.id, card);
      }
    });
  });
  // A card that's the same id in more than one set (e.g. reprinted/shared into a
  // later set) should stay visible under ANY of its sets' filters, not just whichever
  // set's copy happened to win as the displayed row above — see cardMatchesFilters
  // and generateSealedDecks's bySet(), both of which check the full list here rather
  // than just the single primary _setName.
  byId.forEach((card, id)=>{ card._setNames = [...setNamesById.get(id)]; });
  return [...byId.values()];
}

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

// Echo mode is detected once per load, globally, from the union of every authorized
// set's RAW rows (before any row-filtering, since that filtering itself needs to know
// the mode first): if any loaded card is presented the way Echo of Omens presents
// cards — an "O - Overlord" type value — the full Echo deckbuilder loads (leaders,
// aspects, scheme decks, sealed decks, stats...); otherwise every set is treated as a
// generic, game-agnostic card pool.
function detectEchoMode(rawSetResults){
  return rawSetResults.some(s => s.rows.some(r => String(r.type||'').trim() === 'O - Overlord'));
}

function applyModeUI(){
  document.body.classList.toggle('generic-mode', !state.isEchoMode);
  const titleEl = document.getElementById('topbarTitle');
  // The current GAME's own live folder name drives branding for both modes now —
  // simpler and more accurate than a hardcoded "ECHO OF OMENS" string, and it stays
  // correct even if that folder ever gets renamed.
  const gameName = state.currentGameLabel || (state.authorizedSets[0] && state.authorizedSets[0].label) || 'Card Set';
  titleEl.textContent = gameName.toUpperCase();
  document.title = gameName + ' — Deckbuilder';
}

async function loadData(silent){
  if(!silent) setSyncStatus('loading card data…');
  showLoadingOverlay();
  try{
    const rawSetResults = []; // [{rows, setName, folderId, sheetId}]

    // Fetched concurrently rather than one set at a time — each fast=true fetch is
    // now just a Sheets read, independent of every other set, so there's no reason
    // to make one set's request wait on another's round trip. A set that fails just
    // toasts and gets skipped, same as the old sequential loop's own error handling.
    const fastResults = await Promise.allSettled(
      state.authorizedSets.map(entry => fetchSetData(entry.folderId, true))
    );
    fastResults.forEach((res, i)=>{
      const entry = state.authorizedSets[i];
      if(res.status==='rejected'){
        console.error('Could not load set '+entry.folderId+':', res.reason);
        toast(`Could not load set "${entry.label}": ${res.reason.message}`);
        return;
      }
      const result = res.value;
      if(!state.headers.length && result.rows.length){
        state.headers = Object.keys(result.rows[0]);
        state.hasImages = state.headers.includes('front-image-url');
      }
      rawSetResults.push({
        rows: result.rows,
        setName: result.setName || entry.label,
        folderId: entry.folderId,
        sheetId: result.sheetId, // the set's actual Google Sheet file id, distinct from its folderId — see getSetData; needed below so exported decks carry a sheetId the game room app can actually look up (getKnownSetSheets() in Code.gs indexes by sheet id, never folder id)
      });
    });

    state.isEchoMode = detectEchoMode(rawSetResults);

    // Every card's own _sheetId (see processRawRows) has to be the actual Google
    // Sheet file id (s.sheetId), NOT the set's folder id (s.folderId) — this was
    // passing folderId here, which is fine for everything the deckbuilder itself
    // does (folderId already uniquely identifies a set internally), but meant
    // every deck exported to JSON carried a bogus "sheetId" the game room app
    // could never actually look up, failing with "Unknown sheet" on import.
    const setCardLists = rawSetResults.map(s => processRawRows(s.rows, s.setName, s.sheetId, state.isEchoMode));
    const rows = mergeCardSets(setCardLists);

    state.cards = rows;
    state.byId = new Map(rows.map(r=>[r.id, r]));
    applyModeUI();
    applyPcioUI();
    computeAndCacheAspects();
    computeFieldDefs();
    renderAll();
    // Card text is in and the grid is already rendered and usable — don't make the
    // user wait on art, or on the game-level assets (card backs/.pcio board), either.
    // hideLoadingOverlay() happens here; both background passes below pop their own
    // results in once they finish (see syncAllSetImages/applySetImages and
    // loadGameAssetsInBackground/applyPcioUI).
    hideLoadingOverlay();
    if(state.hasImages && rawSetResults.length){
      setSyncStatus('synced ' + syncTime() + ' — loading art…');
      syncAllSetImages(rawSetResults);
    } else {
      setSyncStatus('synced ' + syncTime() + (state.hasImages?'':' — no art columns found yet'));
    }
    if(state.currentGameFolderId) loadGameAssetsInBackground(state.currentGameFolderId);
    if(state.currentGameFolderId) loadPrecons(true);
  }catch(err){
    console.error(err);
    setSyncStatus('sync failed — check your connection ('+err.message+')');
    toast('Could not load card data: '+err.message);
    hideLoadingOverlay();
  }
}

// Runs each authorized set's slow art-folder scan independently in the background —
// as each one resolves, that set's cards update their art in place (see
// applySetImages) rather than waiting for every set to finish first.
function syncAllSetImages(rawSetResults){
  let pending = rawSetResults.length;
  rawSetResults.forEach(async (s)=>{
    try{
      const result = await fetchSetImages(s.folderId);
      applySetImages(result.images || []);
    }catch(e){
      console.error('Could not sync art for set '+s.folderId+':', e);
      toast(`Could not load art for "${s.setName}": ${e.message}`);
    }
    pending--;
    if(pending<=0) setSyncStatus('synced ' + syncTime());
  });
}

// Merges freshly-synced image URLs (see the syncSetImages endpoint in Code.gs) into
// already-loaded cards and re-renders anything currently showing art, so a card's
// image "pops in" once it's ready without the user having to do anything.
function applySetImages(images){
  let changed = false;
  images.forEach(img=>{
    const c = state.byId.get(img.id);
    if(!c) return;
    const front = String(img['front-image-url']||'').trim();
    const back = String(img['back-image-url']||'').trim();
    noteSmallImage(front, img['front-image-sm-url']);
    noteSmallImage(back, img['back-image-sm-url']);
    if(c._front !== front || c._back !== back){ c._front = front; c._back = back; changed = true; }
  });
  if(changed) renderAll();
}

// Catches up the game-level assets (card backs, .pcio board) a fast=true loadData()
// skipped — silent and non-blocking: nothing about browsing or deckbuilding depends
// on this, it just enables Download .pcio / Playtest Room / the CSV export option
// (via applyPcioUI) and the export card-back URLs once it resolves.
async function loadGameAssetsInBackground(gameFolderId){
  try{
    const assets = await fetchGameAssets(gameFolderId);
    state.genericBackUrl = assets.genericBackUrl || '';
    state.genericBacks = {
      overlordBackUrl: assets.overlordBackUrl || '',
      schemeBackUrl: assets.schemeBackUrl || '',
      championBackUrl: assets.championBackUrl || '',
    };
    state.pcio = assets.pcio || {found:false};
    applyPcioUI();
  }catch(e){
    console.error('Could not load game assets for '+gameFolderId+':', e);
    // Non-fatal — those buttons just stay hidden and card-back export URLs stay
    // blank until the next reload; nothing else in the app depends on this.
  }
}
function syncTime(){ return new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }
function setSyncStatus(s){ const el = document.getElementById('sync-status'); el.textContent = s; el.title = s; } // title: the full text when it's cut short
function showLoadingOverlay(){ document.getElementById('loading-overlay').classList.add('active'); }
function hideLoadingOverlay(){ document.getElementById('loading-overlay').classList.remove('active'); }

// playingcards.io-flavored features (downloading this game's own .pcio board, the
// "New Blank Room" link to playingcards.io itself, and the playingcards.io CSV export
// option) only make sense for a game that actually has a .pcio file in its main
// folder — never dead buttons/options that just error when used, for a game that
// isn't set up for playingcards.io at all.
// A game with one or more room board layouts in its folder (see getPrecons in
// Code.gs) plays in the game room instead: "Send deck to room" replaces the
// playingcards.io buttons (its CSV export stays available under Export).
function applyPcioUI(){
  const hasPcio = !!(state.pcio && state.pcio.found);
  const hasBoards = !!(state.precons && state.precons.boards && state.precons.boards.length);
  document.getElementById('btnDownloadPcio').style.display = (hasPcio && !hasBoards) ? 'inline-flex' : 'none';
  document.getElementById('btnPlaytestRoom').style.display = (hasPcio && !hasBoards) ? 'inline-flex' : 'none';
  document.getElementById('btnSendToRoom').style.display = hasBoards ? 'inline-flex' : 'none';
  document.getElementById('optExportCsv').style.display = hasPcio ? '' : 'none';
}

