/* =========================================================================
   CARD LIBRARY (private) — fetching a sheet's cards through the Drive-gated
   Apps Script (with the per-account cache, the "Classified" handling and the
   Echo-style back/rotation conventions). Plugged in through roomServices
   (loadSheet, sizedUrl, cardBackUrl, cardRotationFor, deckLeadIds); moved here
   unchanged from the shared card-library section.
   ========================================================================= */
// The card-library Apps Script — a REUSABLE SERVICE URL (same distinction as
// ROOM_WEBAPP_URL: not tied to any specific sheet's data), used only to resolve
// a given sheet id's cards through ITS OWN elevated ("Execute as: Me")
// permissions. This matters because a card-library sheet often isn't shared
// "anyone with the link" — it doesn't need to be, for the deckbuilder itself to
// work — so the room app can't always rely on fetching it directly.
const CARD_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxuoxW84Mn4Grrq2T9_RCoCJO1ftMdBPJ2gNqcwW5T7wXNonNjZaKOcxgc3ZQAHanVpZQ/exec';


/* ---------- Persistent (cross-session) sheet card cache ----------
   Pure speed optimization, never a substitute for the real check: the live
   round-trip in fetchSheetCards below always still runs, every single time,
   and its result always wins, overwriting whatever the cache put in
   cardsById. All this buys is letting a set the account has already been
   granted access to (this session or a past one) render its real faces the
   instant it's needed instead of sitting on "Access Pending" for however
   long that round-trip takes — most returning-player imports become
   effectively instant, with the network fetch reconfirming silently in the
   background. Scoped per signed-in account (email) so a shared/kiosk browser
   never shows one person's cached cards to whoever signs in next; classified
   (denied) sheets are deliberately never cached — there's no card data in
   that response worth keeping, and a set that WAS cached but comes back
   classified on recheck means access was revoked since, so the stale entry
   is dropped and the player is told (see fetchSheetCards) rather than ever
   silently reappearing. */
const CARD_CACHE_VERSION = 'v1';
function cardCacheKey(sheetId){
  if(!state.userEmail) return null; // no account identity yet (shouldn't happen post-sign-in) — don't cache blind
  return `eoo_sheet_cache_${CARD_CACHE_VERSION}:${state.userEmail}:${sheetId}`;
}
// Returns true if a cache entry existed (whether or not it parsed cleanly) —
// fetchSheetCards uses this to know whether a classified result later means
// "access was just revoked" (worth a toast) versus "never had access at all".
function applyCachedSheetCards(sheetId){
  const key = cardCacheKey(sheetId);
  if(!key) return false;
  const raw = localStorage.getItem(key);
  if(!raw) return false;
  try{
    const cached = JSON.parse(raw);
    (cached.rows||[]).forEach(r=>{
      if(!r || !r.id) return;
      cardsById.set(r.id, r);
      preloadCardFace(r._front);
      if(r._doubleSided) preloadCardFace(r._back);
    });
    // Older cache entries (written before card-back support existed) simply
    // have no `backs` key — sheetBacksById just doesn't get set for this
    // sheet yet, same as an unconfigured game, and the live fetch below
    // fills it in (and re-caches it with backs included) momentarily.
    if(cached.backs){ sheetBacksById.set(sheetId, cached.backs); preloadSheetBacks(cached.backs); }
  }catch(e){ /* corrupt entry — treat as no cache, live fetch below still runs regardless */ }
  return true;
}
function cacheSheetCards(sheetId, rows, backs){
  const key = cardCacheKey(sheetId);
  if(!key) return;
  try{ localStorage.setItem(key, JSON.stringify({ rows, backs, ts: Date.now() })); }
  catch(e){ /* storage full/unavailable/private-browsing — caching is best-effort only */ }
}
function clearCachedSheetCards(sheetId){
  const key = cardCacheKey(sheetId);
  if(!key) return;
  try{ localStorage.removeItem(key); }catch(e){}
}

// Both attempts below go through the card-library script's own elevated
// ("Execute as: Me") permissions, gated by the signed-in idToken (see
// getCardsBySheetId in Code.gs). The old direct-CSV-export fallbacks are
// gone on purpose: they worked by reading the sheet however IT happened to
// be shared, completely bypassing the per-set access check — exactly the
// hole that made "not authorized" meaningless for any sheet that was ever
// shared "anyone with the link". Losing them means a sheet must go through
// the gated endpoint to be usable in the room at all, same as the deckbuilder.
async function fetchSheetCards(sheetId){
  // Runs synchronously, before anything below even reaches the network —
  // see the cache helpers' own comment. registerPendingCards (called by
  // every caller of ensureSheetsLoaded, just before it) has already stood in
  // "Access Pending" placeholders for every id on this piece; this
  // immediately overwrites the ones this sheet actually owns with their real
  // cached data, so a returning player often never sees "Access Pending" at
  // all for a set they already have. wasCached remembers whether there was
  // something to roll back from, purely so a set that turns out to be
  // classified on THIS check can say "access was revoked" instead of just
  // silently landing on Classified same as a set never seen before.
  const wasCached = applyCachedSheetCards(sheetId);
  const attempts = roomServices.cardAttempts(sheetId);
  let lastErr;
  for(const attempt of attempts){
    try{
      const data = await attempt();
      if(data.classified){
        // Signed in, but not authorized for this set — the server withholds
        // every field but id. Still register a real (placeholder) card per id
        // so pieces referencing them work normally (move/stack/count/flip);
        // only the face rendering (cardFaceHtml/pieceFaceHtml etc.) treats
        // _classified specially, showing "Classified" instead of art/name.
        (data.ids||[]).forEach(id=>{
          if(id) cardsById.set(id, { id, name:'Classified', _classified:true, _sheetId:sheetId });
        });
        if(wasCached){
          // This account HAD cached access to this set (this session or a
          // past one) and just lost it — the brief real faces the player saw
          // a moment ago (from cache, before this check landed) are already
          // overwritten by the classified placeholders above; drop the stale
          // cache entry too so a future session doesn't repeat the flash,
          // and say something, since this is a real access change, not just
          // an ordinary first-time "not authorized".
          clearCachedSheetCards(sheetId);
          toast(`Access to "${sheetNamesById.get(sheetId)||sheetId}" is no longer available — showing as Classified.`);
        }
        return;
      }
      (data.rows||[]).forEach(r=>{
        r._front = (r['front-image-url']||'').trim();
        r._back = (r['back-image-url']||'').trim();
        r._doubleSided = String(r.is_double_sided).trim().toUpperCase()==='TRUE';
        r._rotate = cardArtRotation(r); // sideways art in a portrait image — the preview turns it upright
        r._sheetId = sheetId; // so a piece's cards can be traced back to their sheet when exporting a layout
        if(r.id) cardsById.set(r.id, r);
        // Preload both faces right away — see preloadCardFace's own comment —
        // so flipping a card for the first time doesn't have to wait on a
        // fresh network fetch. The back only ever gets shown for a genuinely
        // double-sided card (see cardFaceHtml); everything else falls back to
        // this sheet's generic back (below) or, failing that, a plain cardback.
        preloadCardFace(r._front);
        if(r._doubleSided) preloadCardFace(r._back);
      });
      // The game-level generic card backs (see Code.gs's getCardsBySheetId /
      // scanGameFolderAssets) — absent entirely on an older Code.gs deployment
      // that doesn't send them yet, in which case cardBackImageUrl's callers
      // just keep falling back to the plain "🂠" placeholder as before.
      const backs = { genericBackUrl:'', overlordBackUrl:'', schemeBackUrl:'', championBackUrl:'' };
      if(data.genericBackUrl || data.genericBacks){
        backs.genericBackUrl = data.genericBackUrl || '';
        backs.overlordBackUrl = (data.genericBacks && data.genericBacks.overlordBackUrl) || '';
        backs.schemeBackUrl = (data.genericBacks && data.genericBacks.schemeBackUrl) || '';
        backs.championBackUrl = (data.genericBacks && data.genericBacks.championBackUrl) || '';
        sheetBacksById.set(sheetId, backs);
        preloadSheetBacks(backs);
      }
      // Persist for next time — see the cache helpers' own comment. Cached
      // AFTER the augmentation above so what's stored already carries
      // _front/_back/_doubleSided/_sheetId (and the resolved backs), ready to
      // drop straight into cardsById/sheetBacksById next session with no
      // reprocessing.
      cacheSheetCards(sheetId, data.rows, sheetBacksById.get(sheetId) || null);
      return;
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('Could not load cards for sheet '+sheetId);
}

// Same "#img-src"/"#pdf-src" marker Code.gs's artUrl() tags every art URL
// with (see deckbuilder.html's sizedUrl for the full rationale): a PNG/JPEG
// source is requested at its own native size (fast — no on-demand CDN
// resize), while a PDF-rendered source still asks for a specific pixel width
// (the only way to get a viewable image out of a PDF page at all). Without
// this, appending "=w{px}" after the URL's fragment did nothing (a fragment
// is never sent with the request), so every card here was silently already
// being fetched at native size — harmless for plain images, but meant a
// PDF-sourced card's thumbnail request was subtly broken too.
function driveSizedUrl(url, w){
  if(!url) return '';
  const isImage = url.includes('#img-src');
  const base = url.split('#')[0];
  return isImage ? base : (base + '=w' + w);
}

function echoCardBackUrl(card, backs){
  const type = card.type || '';
  if(type === 'O - Scheme') return backs.schemeBackUrl || backs.genericBackUrl || '';
  if(type.indexOf('O -')===0) return backs.overlordBackUrl || backs.genericBackUrl || '';
  if(type.indexOf('C -')===0) return backs.championBackUrl || backs.genericBackUrl || '';
  return backs.genericBackUrl || '';
}
roomServices.loadSheet = fetchSheetCards;
roomServices.sizedUrl = driveSizedUrl;
roomServices.cardBackUrl = echoCardBackUrl;

// Echo's own landscape card types print sideways (90°) — the same rule the deckbuilder uses.
const ROOM_HORIZONTAL_TYPES = new Set(['O - Scheme','O - Domination','C - Quest','O - Stronghold','C - Resistance']);
roomServices.cardRotationFor = function(r){
  if(ROOM_HORIZONTAL_TYPES.has(r.type) || (r.type==='Z - Custom' && (r.name==='Stronghold' || r.name==='Resistance'))) return 90;
  return 0;
};
