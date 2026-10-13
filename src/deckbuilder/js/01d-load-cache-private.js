/* =========================================================================
   SAVED CARDS (private). After a successful load the browser keeps a copy of
   the signed-in person's game/set list and each set's card rows, so a return
   visit can show cards straight away while the server re-checks everything in
   the background (see loadData / onGoogleSignIn). It is only a speed-up:
   - it is stored per account email and only ever shown to that same account's
     sign-in, and the server is still asked on every visit — a failed access
     check wipes it;
   - signing out wipes it;
   - any storage problem (private mode, full quota) just means no speed-up.
   ========================================================================= */
const LS_CARD_CACHE_KEY = 'eoo_saved_cards_v1';
const CARD_CACHE_MAX_AGE_MS = 30*24*60*60*1000;

function cardCacheRead(email){
  try{
    const raw = localStorage.getItem(LS_CARD_CACHE_KEY);
    if(!raw) return null;
    const blob = JSON.parse(raw);
    if(!blob || blob.email!==email || !blob.games || Date.now()-blob.savedAt > CARD_CACHE_MAX_AGE_MS) return null;
    return blob;
  }catch(e){ return null; }
}
function cardCacheWrite(blob){
  try{ blob.savedAt = Date.now(); localStorage.setItem(LS_CARD_CACHE_KEY, JSON.stringify(blob)); }
  catch(e){ try{ localStorage.removeItem(LS_CARD_CACHE_KEY); }catch(e2){} } // too big / blocked: no speed-up, no harm
}
function cardCacheClear(){ try{ localStorage.removeItem(LS_CARD_CACHE_KEY); localStorage.removeItem('eoo_saved_precons_v1'); }catch(e){} }

// The email inside a Google sign-in credential. Used ONLY to find this person's own saved copy in
// their own browser — never to decide what they may see (the server still does that).
function emailFromCredential(credential){
  try{
    const payload = JSON.parse(atob(credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return String(payload.email||'').toLowerCase() || null;
  }catch(e){ return null; }
}

function cardCacheLoadGames(email){
  const blob = email ? cardCacheRead(email) : null;
  return blob ? blob.games : null;
}
function cardCacheSaveGames(email, games){
  const blob = cardCacheRead(email) || { email, games:[], sets:{} };
  blob.email = email; blob.games = games;
  cardCacheWrite(blob);
}
// Saved rows for every one of these sets, as fresh copies — or null unless ALL of them are saved.
function cardCacheLoadSets(authorizedSets){
  const blob = state.userEmail ? cardCacheRead(state.userEmail) : null;
  if(!blob || !authorizedSets.length) return null;
  const out = [];
  for(const entry of authorizedSets){
    const s = blob.sets && blob.sets[entry.folderId];
    if(!s) return null;
    out.push({ rows: JSON.parse(JSON.stringify(s.rows)), setName: s.setName, folderId: entry.folderId, sheetId: s.sheetId, sheetName: s.sheetName||'' });
  }
  return out;
}
function cardCacheSaveSets(rawSetResults){
  if(!state.userEmail) return;
  const blob = cardCacheRead(state.userEmail) || { email: state.userEmail, games: state.games||[], sets:{} };
  blob.sets = blob.sets || {};
  rawSetResults.forEach(s=>{ blob.sets[s.folderId] = { rows: s.rows, setName: s.setName, sheetId: s.sheetId, sheetName: s.sheetName||'' }; });
  cardCacheWrite(blob);
}

// Saved preconstructed decks / room boards per game, so "Send to room" (and the Precon button)
// can appear the moment a game opens, before the server's slower listing has come back.
// Kept under its own key so it can never disturb the saved cards; skipped if unusually large.
const LS_PRECON_CACHE_KEY = 'eoo_saved_precons_v1';
function preconCacheLoad(gameId){
  try{
    const blob = JSON.parse(localStorage.getItem(LS_PRECON_CACHE_KEY)||'null');
    if(!blob || blob.email!==state.userEmail || Date.now()-blob.savedAt > CARD_CACHE_MAX_AGE_MS) return null;
    const p = blob.byGame && blob.byGame[gameId];
    return p ? { canEdit: !!p.canEdit, decks: p.decks||[], boards: p.boards||[] } : null;
  }catch(e){ return null; }
}
function preconCacheSave(gameId, precons){
  if(!state.userEmail) return;
  try{
    let blob = JSON.parse(localStorage.getItem(LS_PRECON_CACHE_KEY)||'null');
    if(!blob || blob.email!==state.userEmail) blob = { email: state.userEmail, byGame:{} };
    blob.byGame[gameId] = precons;
    blob.savedAt = Date.now();
    const raw = JSON.stringify(blob);
    if(raw.length > 1500000) return;
    localStorage.setItem(LS_PRECON_CACHE_KEY, raw);
  }catch(e){ try{ localStorage.removeItem(LS_PRECON_CACHE_KEY); }catch(e2){} }
}
