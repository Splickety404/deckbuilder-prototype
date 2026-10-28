/* =========================================================================
   CONFIG
   ========================================================================= */
const LS_DECKS_KEY = 'eoo_deckbuilder_saved_decks_v2';
const LS_THEME_KEY = 'eoo_theme';
const LS_LAST_VISIT_KEY = 'eoo_last_visit';
const LS_CARD_SCALE_KEY = 'eoo_card_scale';
const CARD_SCALE_MIN = 120, CARD_SCALE_MAX = 280, CARD_SCALE_DEFAULT = 170;
// Hover preview is always 20% bigger than the largest size cards can be scaled to —
// tied to CARD_SCALE_MAX itself, not the current slider value, so it stays consistently
// large-and-readable regardless of how small the user has the grid tiles set.
const HOVER_PREVIEW_WIDTH = Math.round(CARD_SCALE_MAX * 1.2);
const HOVER_PREVIEW_LANDSCAPE_WIDTH = Math.round(HOVER_PREVIEW_WIDTH * 7/5); // rotated card — width should roughly match a normal preview's height
const HOVER_FETCH_WIDTH = Math.round(HOVER_PREVIEW_WIDTH * 1.3); // fetched a bit larger than display size for crispness

// Structural fields the app's mechanics depend on — never treated as generic filters.
// Bookkeeping columns the Card Updater writes alongside the card data (which
// fields a card's record had, art fingerprints, small-image links) — never card fields.
const CARD_UPDATER_COLUMNS = ['record-fields','image-hash','back-image-hash','front-image-sm-url','back-image-sm-url'];
const NEVER_FIELDS = new Set(['traits-to-packet','name','ability','ability-overlord','ability-stage-2','ability-overlord-stage-2','setup','modifiers-scripted','collect-icons','collect-modifiers-scripted','collect-icons-stage-2','outcome-icons-stage-2-scripted','tactics-modifiers-stage-2-scripted','collect-modifiers-stage-2-scripted','id','is_double_sided','front-image-url','back-image-url','last-updated','is-double-sided','rotate', ...CARD_UPDATER_COLUMNS]);
// Numeric stat fields where a literal 0 means "doesn't have this stat" (as opposed to
// cost/difficulty, which already correctly use a blank cell for "not applicable").
const ZERO_AS_ABSENT = new Set(['health-number','attack','block','inherent-arcane','inherent-diplomacy','inherent-stealth','leadership','willpower']);
const LABEL_OVERRIDES = {
  'card-cost':'Cost','health-number':'Health','inherent-arcane':'Arcane',
  'inherent-diplomacy':'Diplomacy','inherent-stealth':'Stealth',
  'skill-check-type':'Skill Check Type','bonus-icons-scripted':'Bonus Icons',
};

function colorForAspect(a){
  if(state.game.aspectColors[a]) return state.game.aspectColors[a];
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
// The part of a deck every game has; a game adds whatever else its decks hold (see slotExtras
// in the game definition).
function freshDeckSlot(){
  return {
    name:'', deckCards:new Map(), deckOrder:[],
    sourceExportedAt:null, // timestamp this deck was last exported (or the imported file's own stamp) — the "changed since" baseline
    ...state.game.slotExtras(),
  };
}
function freshFilters(){ return {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()}; }
// Starts every deck and every view's filters from scratch for the current game.
function freshDeckState(){
  state.decks = Object.fromEntries(state.game.deckKeys.map(k=>[k, freshDeckSlot()]));
  state.filtersByType = Object.fromEntries(state.game.filterKeys.map(k=>[k, freshFilters()]));
}
const state = {
  cards: [], byId: new Map(), headers: [], hasImages: false, fieldDefs: [],
  games: [], // [{folderId, label, sets:[{folderId,label}]}] — every game this signed-in user can see at least one set of, entirely server-decided
  currentGameFolderId: '', // which game's folder id is currently loaded — '' before a game is picked
  currentGameLabel: '', // that game's live folder name, for branding
  authorizedSets: [], // [{folderId, label}] — the CURRENT game's sets this signed-in user may see (a slice of games[i].sets)
  cardScale: CARD_SCALE_DEFAULT, // grid tile min-width in px — user-adjustable, persisted per-browser
  deckType: 'generic',           // which of the game's deck slots you're viewing — a structured game has several (see deckKeys in the game definition)
  // Which game definition the currently-loaded card pool uses (detected once per load —
  // see pickGame()). Starts as defaultGame() so nothing flashes into the wrong styling
  // before the first load completes.
  game: null, // the active GAME DEFINITION (see 01b) — set to defaultGame() right after the definitions load, then to pickGame() on each load
  // One slot per entry in the game's deckKeys — built independently, so switching between them
  // never loses or merges either. A free-form game has just one ('generic'). curDeck()/curFilters()
  // below pick the right one automatically, so the ~130 call sites that go through those two
  // accessors never need to know which game is loaded. Filled in by freshDeckState().
  decks: {},
  // Kept separate from the deck slots (not per-saved-deck) since filters are a browsing
  // preference tied to which view you're on, not which deck you're editing — they should
  // survive New/Save/Load, just never cross between views. Keys come from the game's filterKeys.
  filtersByType: {},
  openFilterGroups: new Set(['type','aspect','loyalty']),
  sortField: 'name',
  selection: new Set(),
  lastClickIndex: null,
  visibleCardsOrder: [],
  precons: {canEdit:false, decks:[], boards:[]}, // this game's preconstructed decks and room board layouts this person may see — see loadPrecons()
  flippedCards: new Set(), // ids currently showing their real back (double-sided cards only)
};
// Whichever key state.decks/state.filtersByType should currently be read/written
// through — the central chokepoint that lets generic mode reuse all the Echo-era
// deck-editing code without a single one of those call sites knowing the difference.
function activeDeckKey(){ return state.game.structured ? state.deckType : 'generic'; }
function curDeck(){ return state.decks[activeDeckKey()]; }
// Filters are a browsing preference tied to which view is showing, not which deck slot is
// being edited — a game can give extra views of the same deck their own filter bucket.
function activeFilterKey(){ return state.game.filterKey(); }
function curFilters(){ return state.filtersByType[activeFilterKey()]; }

