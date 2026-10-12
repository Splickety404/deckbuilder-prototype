/* =========================================================================
   CONFIG
   ========================================================================= */
// No Google Sheet id is hardcoded here. Which sets exist, and which of them this signed-in
// user can see, is decided entirely by the server (Code.gs), based on live Google Drive
// folder-sharing permissions — this file never maintains its own access list.
// WEBAPP_URL is the deckbuilder's own Apps Script deployment — reusable infrastructure,
// not a specific spreadsheet — so it is the only endpoint that may stay hardcoded.
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxuoxW84Mn4Grrq2T9_RCoCJO1ftMdBPJ2gNqcwW5T7wXNonNjZaKOcxgc3ZQAHanVpZQ/exec';
// Google OAuth Client ID — not a secret, meant to sit in client-side code. Must match the
// OAUTH_CLIENT_ID constant in Code.gs so the server accepts ID tokens minted for this app.
const GOOGLE_CLIENT_ID = '1053912607552-pvrm9heedm4floaohv1olp5k5mdp95lq.apps.googleusercontent.com';
const DECK_LIMIT = 50;
const MAX_COPIES = 3;
const SCHEME_DECK_SIZE = 5;
const LS_DECKS_KEY = 'eoo_deckbuilder_saved_decks_v2';
const LS_THEME_KEY = 'eoo_theme';
const LS_LAST_VISIT_KEY = 'eoo_last_visit';
const LS_CARD_SCALE_KEY = 'eoo_card_scale';
const CARD_SCALE_MIN = 120, CARD_SCALE_MAX = 280, CARD_SCALE_DEFAULT = 170;
// Hover preview is always 20% bigger than the largest size cards can be scaled to —
// tied to CARD_SCALE_MAX itself, not the current slider value, so it stays consistently
// large-and-readable regardless of how small the user has the grid tiles set.
const HOVER_PREVIEW_WIDTH = Math.round(CARD_SCALE_MAX * 1.2);
const HOVER_PREVIEW_SCHEME_WIDTH = Math.round(HOVER_PREVIEW_WIDTH * 7/5); // rotated card — width should roughly match a normal preview's height
const HOVER_FETCH_WIDTH = Math.round(HOVER_PREVIEW_WIDTH * 1.3); // fetched a bit larger than display size for crispness

// Structural fields the app's mechanics depend on — never treated as generic filters.
// Bookkeeping columns the Card Updater writes alongside the card data (which
// fields a card's record had, art fingerprints, small-image links) — never card fields.
const CARD_UPDATER_COLUMNS = ['record-fields','image-hash','back-image-hash','front-image-sm-url','back-image-sm-url'];
const NEVER_FIELDS = new Set(['name','ability','id','is_double_sided','front-image-url','back-image-url','last-updated','is-double-sided','rotate', ...CARD_UPDATER_COLUMNS]);
// Numeric stat fields where a literal 0 means "doesn't have this stat" (as opposed to
// cost/difficulty, which already correctly use a blank cell for "not applicable").
const ZERO_AS_ABSENT = new Set(['health-number','attack','block','inherent-arcane','inherent-diplomacy','inherent-stealth','leadership','willpower']);
const LABEL_OVERRIDES = {
  'card-cost':'Cost','health-number':'Health','inherent-arcane':'Arcane',
  'inherent-diplomacy':'Diplomacy','inherent-stealth':'Stealth',
  'skill-check-type':'Skill Check Type','bonus-icons-scripted':'Bonus Icons',
};

const ASPECT_COLORS = { 'Corruption':'#6b3fa0','Wrath':'#a03f3f','Deceit':'#3f8f7a' };
function colorForAspect(a){
  if(ASPECT_COLORS[a]) return ASPECT_COLORS[a];
  let h=0; for(const c of (a||'')) h=(h*31+c.charCodeAt(0))>>>0;
  return `hsl(${h%360},45%,45%)`;
}

/* =========================================================================
   THEME
   ========================================================================= */
function applyTheme(t){ document.documentElement.setAttribute('data-theme', t); localStorage.setItem(LS_THEME_KEY, t); }
function initTheme(){
  const saved = localStorage.getItem(LS_THEME_KEY);
  const theme = saved || ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  applyTheme(theme);
}
initTheme();

/* =========================================================================
   STATE
   ========================================================================= */
function freshDeckSlot(){
  return {
    name:'', leaderId:null, deckCards:new Map(), deckOrder:[], schemeIds:[], overlordMode:'main',
    bonusCardId:null,  // O - Domination (Overlord) / C - Quest (Champion) — its aspect drives bonusAspect below
    extraCardId:null,  // O - Stronghold (Overlord) / C - Resistance (Champion), or the Z-Custom placeholder until real cards exist
    bonusAspect:'',    // derived from bonusCardId's aspect whenever it's set — never chosen independently anymore
    sourceExportedAt:null, // timestamp this deck was last exported (or the imported file's own stamp) — the "changed since" baseline
  };
}
const state = {
  cards: [], byId: new Map(), headers: [], hasImages: false, fieldDefs: [],
  idToken: '', // Google ID token from Sign In With Google — sent with every data request so the server can check Drive permissions
  userEmail: '', // signed-in user's email, from the server's whoami response (not decoded client-side)
  games: [], // [{folderId, label, sets:[{folderId,label}]}] — every game this signed-in user can see at least one set of, entirely server-decided
  currentGameFolderId: '', // which game's folder id is currently loaded — '' before a game is picked
  currentGameLabel: '', // that game's live folder name, for branding
  authorizedSets: [], // [{folderId, label}] — the CURRENT game's sets this signed-in user may see (a slice of games[i].sets)
  cardScale: CARD_SCALE_DEFAULT, // grid tile min-width in px — user-adjustable, persisted per-browser
  deckType: 'overlord',          // 'overlord' | 'champion' — which deck you're currently viewing (Echo mode only)
  // Which game definition the currently-loaded card pool uses (detected once per load —
  // see pickGame()). Starts as defaultGame() so nothing flashes into the wrong styling
  // before the first load completes.
  game: null, // the active GAME DEFINITION (see 01b) — set to defaultGame() right after the definitions load, then to pickGame() on each load
  // Overlord and Champion are built entirely independently — separate leader, aspect,
  // scheme deck, main deck, and name — so switching tabs never loses or merges either.
  // 'generic' is a third, synthetic slot used instead of overlord/champion whenever
  // the game isn't "structured" — curDeck()/curFilters() below pick it automatically, so the
  // ~130 call sites that already go through those two accessors work unmodified.
  decks: { overlord: freshDeckSlot(), champion: freshDeckSlot(), generic: freshDeckSlot() },
  // Kept separate from the deck slots above (not per-saved-deck) since filters are a
  // browsing preference tied to which TAB you're on, not which deck you're editing —
  // they should survive New/Save/Load, just never cross between Overlord and Champion.
  filtersByType: {
    overlord: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
    champion: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
    scheme: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
    generic: {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()},
  },
  openFilterGroups: new Set(['type','aspect','loyalty']),
  sortField: 'name',
  selection: new Set(),
  lastClickIndex: null,
  visibleCardsOrder: [],
  genericBacks: { overlordBackUrl:'', schemeBackUrl:'', championBackUrl:'' }, // Echo mode's own per-type card backs, for exports only
  genericBackUrl: '', // generic (non-Echo) mode's single shared "back.png"/"back.pdf" per game, for exports only
  pcio: {found:false}, // this game's .pcio board file, if it has one — see applyPcioUI()
  precons: {canEdit:false, decks:[], boards:[]}, // this game's preconstructed decks and room board layouts this person may see — see loadPrecons()
  flippedCards: new Set(), // ids currently showing their real back (double-sided cards only)
};
// Whichever key state.decks/state.filtersByType should currently be read/written
// through — the central chokepoint that lets generic mode reuse all the Echo-era
// deck-editing code without a single one of those call sites knowing the difference.
function activeDeckKey(){ return state.game.structured ? state.deckType : 'generic'; }
function curDeck(){ return state.decks[activeDeckKey()]; }
function activeIsSchemeMode(){ return state.game.structured && state.deckType==='overlord' && curDeck().overlordMode==='scheme'; }
// Filters are a browsing preference tied to which TAB is showing, not which deck slot
// is being edited — the Overlord main-deck view and its Scheme view browse the same
// underlying deck slot (curDeck() stays 'overlord' either way, since schemeIds live on
// the overlord slot), but they're different card pools with different useful filters
// (rarity/cost matter for the main deck, less so for a 5-card scheme pool), so they get
// their own bucket here rather than sharing Overlord's.
function activeFilterKey(){ return activeIsSchemeMode() ? 'scheme' : activeDeckKey(); }
function curFilters(){ return state.filtersByType[activeFilterKey()]; }

