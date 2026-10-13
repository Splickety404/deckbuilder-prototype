/* =========================================================================
   DATA LOADING
   ========================================================================= */
// Filters + tags a raw set of sheet rows into real card objects, exactly the same way
// regardless of which set they came from — reused for Set 1's own feed and for every
// additionally imported set, so behavior stays identical either way.
function processRawRows(rawRows, setName, sheetId, game){
  const rows = rawRows.filter(r=> game.keepRow(r));

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

    game.tagCard(r);
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
  // and generateSagaDeck's bySet(), both of which check the full list here rather
  // than just the single primary _setName.
  byId.forEach((card, id)=>{ card._setNames = [...setNamesById.get(id)]; });
  return [...byId.values()];
}






// Which game definition owns the loaded cards is decided once per load by pickGame() (see the game
// definitions) from the union of every set's RAW rows, before any row-filtering, since that
// filtering itself depends on the definition.

function applyModeUI(){
  document.body.classList.toggle('generic-mode', !state.game.structured);
  const titleEl = document.getElementById('topbarTitle');
  // The current game's own name drives branding — it stays correct even if the game is renamed.
  const gameName = state.currentGameLabel || (state.authorizedSets[0] && state.authorizedSets[0].label) || 'Card Set';
  titleEl.textContent = gameName.toUpperCase();
  document.title = gameName + ' — Deckbuilder';
}

// Turns raw per-set rows into the live card list and shows it. Used for the saved copy
// (shown instantly on a return visit) and again for the fresh server copy.
function showLoadedCards(rawSetResults){
  state.game = pickGame(rawSetResults);

  // Every card's own _sheetId (see processRawRows) has to be the actual
  // sheet id (s.sheetId), NOT the set's folder id (s.folderId) — this was
  // passing folderId here, which is fine for everything the deckbuilder itself
  // does (folderId already uniquely identifies a set internally), but meant
  // every deck exported to JSON carried a bogus "sheetId" the game room app
  // could never actually look up, failing with "Unknown sheet" on import.
  const setCardLists = rawSetResults.map(s => processRawRows(s.rows, s.setName, s.sheetId, state.game));
  const rows = mergeCardSets(setCardLists);

  state.cards = rows;
  state.byId = new Map(rows.map(r=>[r.id, r]));
  applyModeUI();
  applyRoomUI();
  state.game.afterCardsLoaded();
  computeFieldDefs();
  renderAll();
}

async function loadData(silent){
  if(typeof perfMark==='function') perfMark('loading card data');
  if(!silent) setSyncStatus('loading card data…');
  // Don't wait for the cards: the room-boards / preconstructed-deck listing is a slow server
  // call of its own, so start it now (in parallel), and meanwhile show the last-known result
  // so "Send to room" is there from the first moment on a return visit.
  if(state.currentGameFolderId){
    const savedPrecons = (!silent && typeof preconCacheLoad==='function') ? preconCacheLoad(state.currentGameFolderId) : null;
    if(savedPrecons && !state.precons.boards.length && !state.precons.decks.length){
      state.precons = savedPrecons;
      applyRoomUI();
      applyPreconUI();
    }
    loadPrecons(true);
  }
  // A return visit shows the saved copy right away (see 01d-load-cache-private.js) and
  // refreshes it below. A manual resync (silent) always goes to the server.
  const saved = (!silent && typeof cardCacheLoadSets==='function') ? cardCacheLoadSets(state.authorizedSets) : null;
  let savedJson = null;
  if(saved){
    savedJson = JSON.stringify(saved.map(s=>s.rows));
    const firstWithRows = saved.find(s=>s.rows.length);
    if(!state.headers.length && firstWithRows){
      state.headers = Object.keys(firstWithRows.rows[0]);
      state.hasImages = state.headers.includes('front-image-url');
    }
    if(typeof registerForgeSets==='function') registerForgeSets(saved);
    showLoadedCards(saved);
    setSyncStatus('showing saved cards — checking for updates…');
    if(typeof perfMark==='function') perfMark('saved cards shown');
  } else {
    showLoadingOverlay();
  }
  try{
    const rawSetResults = []; // [{rows, setName, folderId, sheetId}]
    let anySetFailed = false;

    // Fetched concurrently rather than one set at a time — each fast=true fetch is
    // now just a Sheets read, independent of every other set, so there's no reason
    // to make one set's request wait on another's round trip. A set that fails just
    // toasts and gets skipped, same as the old sequential loop's own error handling.
    const fastResults = await Promise.allSettled(
      state.authorizedSets.map(entry => cardSource.loadSet(entry.folderId, true))
    );
    if(typeof perfMark==='function') perfMark('card data fetched from server');
    fastResults.forEach((res, i)=>{
      const entry = state.authorizedSets[i];
      if(res.status==='rejected'){
        anySetFailed = true;
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
        sheetName: result.sheetName || '',
        sheetId: result.sheetId, // the set's actual data-sheet id, distinct from its folderId — see getSetData; needed below so exported decks carry a sheetId the game room app can actually look up (getKnownSetSheets() in Code.
      });
    });

    // Keep what's already showing if a set failed to refresh (the saved copy beats a gap), or if
    // nothing changed since it was saved (avoids a pointless redraw).
    const keepSavedView = saved && (anySetFailed || JSON.stringify(rawSetResults.map(s=>s.rows))===savedJson);
    if(!anySetFailed && typeof cardCacheSaveSets==='function') cardCacheSaveSets(rawSetResults);
    const forgeChanged = typeof registerForgeSets==='function' ? registerForgeSets(rawSetResults) : false;
    if(!keepSavedView) showLoadedCards(rawSetResults);
    else if(forgeChanged) renderAll(); // the saved view predates the sheet names; redraw so the new buttons appear
    // Card text is in and the grid is already rendered and usable — don't make the
    // user wait on art, either. hideLoadingOverlay() happens here; art pops in per set
    // once each one's scan finishes (see syncAllSetImages/applySetImages).
    hideLoadingOverlay();
    if(typeof perfMark==='function') perfMark('cards up to date');
    if(state.hasImages && rawSetResults.length){
      setSyncStatus('synced ' + syncTime() + ' — loading art…');
      syncAllSetImages(rawSetResults);
    } else {
      setSyncStatus('synced ' + syncTime() + (state.hasImages?'':' — no art columns found yet'));
    }
  }catch(err){
    console.error(err);
    setSyncStatus('sync failed — check your connection ('+err.message+')');
    if(!saved) toast('Could not load card data: '+err.message);
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
      const result = await cardSource.loadSetImages(s.folderId);
      applySetImages(result.images || []);
    }catch(e){
      console.error('Could not sync art for set '+s.folderId+':', e);
      toast(`Could not load art for "${s.setName}": ${e.message}`);
    }
    pending--;
    if(pending<=0){
      setSyncStatus('synced ' + syncTime());
      if(typeof perfMark==='function'){ perfMark('art synced'); perfReport(); }
    }
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

function syncTime(){ return new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }
function setSyncStatus(s){ const el = document.getElementById('sync-status'); el.textContent = s; el.title = s; } // title: the full text when it's cut short
function showLoadingOverlay(){ document.getElementById('loading-overlay').classList.add('active'); }
function hideLoadingOverlay(){ document.getElementById('loading-overlay').classList.remove('active'); }

// Games with room boards play in the game room: "Send deck to room" shows only then.
function applyRoomUI(){
  const hasBoards = !!(state.precons && state.precons.boards && state.precons.boards.length);
  document.getElementById('btnSendToRoom').style.display = hasBoards ? 'inline-flex' : 'none';
}
