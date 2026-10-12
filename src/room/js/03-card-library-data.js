/* =========================================================================
   CARD LIBRARY DATA — NO card-library sheet id is hardcoded here at all. Every
   imported deck's JSON carries the exact sheet id(s) its own cards come from
   (deckJson.sourceSheets); this app fetches each one, on demand, the first
   time it's needed this session (knownSheetIds), and also checks a
   persistent per-account cache in localStorage so a set already fetched in a
   PAST session doesn't even wait on that first round-trip (see
   applyCachedSheetCards/cacheSheetCards below) — either way, the real
   server-side access check still always runs and always wins. A deck mixing
   cards from two different sets simply means two sheets get fetched instead
   of one, and any client that receives a synced piece referencing a sheet it
   hasn't fetched yet (because another player did the importing) fetches it
   too, lazily.
   ========================================================================= */
const cardsById = new Map();
const knownSheetIds = new Set(); // sheets already fetched (or currently being fetched)
const sheetNamesById = new Map(); // sheetId -> setName, for re-embedding sourceSheets on layout export
// sheetId -> {genericBackUrl, …} — the per-GAME (not per-set) card-back art
// roomServices.loadSheet pulls in alongside a sheet's rows. Every sheet in the same
// game shares one entry here, keyed redundantly under each of that game's sheet ids —
// simpler than a second gameFolderId->sheetIds index for what's a tiny amount of data.
const sheetBacksById = new Map();
// Fetches whatever sheets in the given list aren't already cached. Safe to call
// repeatedly/concurrently with overlapping lists — already-known sheets are skipped.
async function ensureSheetsLoaded(sourceSheets){
  (sourceSheets||[]).forEach(s=>{ if(s && s.sheetId && s.setName) sheetNamesById.set(s.sheetId, s.setName); });
  const toFetch = (sourceSheets||[]).filter(s=>s && s.sheetId && !knownSheetIds.has(s.sheetId));
  if(!toFetch.length) return;
  toFetch.forEach(s=>knownSheetIds.add(s.sheetId)); // mark BEFORE awaiting, so concurrent calls don't double-fetch
  await Promise.all(toFetch.map(s=>roomServices.loadSheet(s.sheetId).catch(e=>{
    console.error('Could not load sheet '+s.sheetId+':', e);
    knownSheetIds.delete(s.sheetId); // allow a retry later
    toast(`Could not load cards from "${s.setName||s.sheetId}": ${e.message}`);
  })));
}
// Registers a lightweight stand-in for every id whose real data (or "Classified"
// status) isn't known yet — called the instant a piece referencing an unfetched
// sheet appears on the board (deck import, a synced PLACE_PIECE/LOAD_LAYOUT/
// STATE_SNAPSHOT from another client), always BEFORE the renderBoard() that
// follows in the same tick, so that first render shows "Access Pending" (see
// pending-face CSS, cardFaceHtml/pieceFaceHtml/cardFrontInnerHtml) instead of
// either a bare "?" or — worse — blocking on the network at all. Whichever
// sheet each pending id actually belongs to is still in flight and unknown
// here, so this can't fill in _sheetId; that's fine, fetchSheetCards
// unconditionally overwrites every id it resolves (real row or classified)
// the moment its sheet comes back, pending placeholder included. Never
// overwrites an id that's already resolved one way or the other.
function registerPendingCards(cardIds){
  (cardIds||[]).forEach(id=>{
    if(id && !cardsById.has(id)) cardsById.set(id, { id, name:'Access Pending', _pending:true });
  });
}
// Every sheet referenced by any card currently placed on the board/held in hand —
// used to re-embed exactly the decks a saved layout needs into its export.
function sourceSheetsInUse(){
  const ids = new Set();
  state.pieces.forEach(p=> p.cardIds.forEach(cid=>{ const c=cardsById.get(cid); if(c && c._sheetId) ids.add(c._sheetId); }));
  return [...ids].map(sheetId=>({ sheetId, setName: sheetNamesById.get(sheetId)||sheetId }));
}
// Art links are resized by whoever knows how the image host works — see roomServices.sizedUrl.
function sizedUrl(url, w){ return roomServices.sizedUrl(url, w); }
// Warms the browser's image cache for a card face the instant its URL is
// known (see fetchSheetCards), rather than waiting for the first time a
// player actually flips to it — that first flip used to be the first time
// the browser ever requested the image at all, so it visibly popped in a
// beat late. Preloads at both sizes actually used to display a card: 320px
// (an ordinary board/hand face — see cardFaceHtml/pieceFaceHtml) and 700px
// (the larger hover preview — see showHoverPreview). A bare `new Image()`
// with its `src` set is the standard way to get the browser to fetch and
// cache a URL without putting anything on screen; nothing here holds a
// reference to the Image past this call because nothing needs to — once
// the browser has it cached, the real <img> tag rendered later reuses it.
// The Image objects are kept (heldArt) so the browser keeps them in memory:
// the board redraws its cards after nearly every move, and a picture no
// longer held anywhere could otherwise be fetched (and pop in) all over again.
const heldArt = new Map();
function preloadCardFace(url){
  if(!url) return;
  [sizedUrl(url, 320), sizedUrl(url, 700)].forEach(src=>{
    if(heldArt.has(src)) return;
    const img = new Image(); img.decoding = 'async'; img.src = src;
    heldArt.set(src, img);
  });
}
// Picks the card-back image for a card that isn't itself genuinely double-sided
// (cardFaceHtml/pieceFaceHtml/showHoverPreview all fall back to this only after checking
// card._doubleSided/_back first). Which of a game's backs a card gets is the game's call —
// see roomServices.cardBackUrl. Returns '' when nothing is configured — every caller already
// falls back to the plain "🂠" placeholder in that case, so a game with no back files uploaded
// degrades to exactly today's look, nothing breaks.
function cardBackImageUrl(card){
  if(!card || !card._sheetId) return '';
  const backs = sheetBacksById.get(card._sheetId);
  if(!backs) return '';
  return roomServices.cardBackUrl(card, backs);
}
// Preloads every back image a sheet's game actually has configured, the
// instant they're known (fresh fetch or restored from cache) — same rationale
// as preloadCardFace, so the very first card flipped face-down doesn't have to
// wait on a fresh network request for its back.
function preloadSheetBacks(backs){
  if(!backs) return;
  Object.values(backs).forEach(preloadCardFace);
}

