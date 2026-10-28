/* =========================================================================
   GAME DEFINITIONS — how the loaded card pool is presented and what rules
   apply. Everything that used to be `if(state.isEchoMode)` is now a question
   asked of `state.game`, so a new kind of game is a new definition object
   rather than another branch scattered through the code. A definition has:
     deckKeys, filterKeys, defaultDeckType, slotExtras()   the deck slots / filter buckets a game has,
                         which slot is open first, and the extra fields a deck holds
     filterKey()         which filter bucket the current view uses
     isTypeEligible(card) / isLegal(card)   hard "may it go in the deck" rule / softer legality
     defaultSort         the card pool's sort field when this game is first loaded
     inActiveView(card)  does the card pool show this card in the current view (a game whose
                         deck panel has several boxes shows one box's cards at a time)
     aspectColors, afterCardsLoaded()       optional colors for named attributes / post-load hook
     discordShare        card feedback may also be posted to the game's Discord (Echo only)
     id, structured      structured = extra deck setup, several deck tabs, side lists
                         (Echo); false = one free-form deck, any card
     multiValueSplit     how "Fire/Water"-style fields split into values
     commaSplits         whether a comma also counts as a separator
     keepRow(row)        is this spreadsheet row a real card?
     tagCard(card)       sets the card's derived flags (double-sided, rotation…)
     copyLimit(card)     most copies the deck panel treats as legal
     deckSummary()       -> {title, text, bad}: the deck panel's title and size label
     listCount(id) / removeOne(id)   how many of a card the active list holds / remove one
     illegalHint         tooltip for a card that isn't legal for the deck
     renderTabs() / renderDeckControlsExtras() / renderViewStats()   extra panel UI (optional)
     renderDeckList      null, or a function(zone) that draws the deck list itself (grouped into boxes…)
     matches(rawSets)    (optional) true if this definition owns the loaded sets
   ========================================================================= */
/* ---- DECK CODEC — how a deck is written to / read from a saved deck, a .json or .txt file,
   and the print list. The shared code owns the part every game has
   (name, cards, card order); the codec owns whatever extra a game puts in a deck (leaders,
   side decks…). The plain codec below has no extras, so a free-form game's files hold
   just the cards. Methods (d = the deck slot being read/written):
     saveExtras(d) / applySaved(saved, d)      extras kept in the browser's saved decks
     jsonFields(d) / applyJson(file, d)        extras in the .json deck file
     textSetupLines(d) / textSideListLines(d)    extra lines in the .txt decklist
     parseTextLine(line, ctx)                  true if the line is a game-specific one
     parseTextItem(ctx, match)                 true if a "3x Name" line belongs to a game-specific section
     finishTextImport(ctx, byName, unmatched)  turn parsed names back into the deck
     printLead(d)                              cards printed before the deck itself
     referencedIds(d)                          card ids the deck points at besides its main cards */
const PlainDeckCodec = {
  saveExtras(d){ return {}; },
  applySaved(saved, d){},
  jsonFields(d){ return {}; },
  applyJson(file, d){},
  textSetupLines(d){ return []; },
  textSideListLines(d){ return []; },
  parseTextLine(line, ctx){ return false; },
  parseTextItem(ctx, match){ return false; },
  finishTextImport(ctx, byName, unmatched){},
  printLead(d){ return []; },
  referencedIds(d){ return []; },
};
function deckCodec(){ return state.game.deckCodec; }

const GenericGame = {
  id: 'generic',
  structured: false,
  deckCodec: PlainDeckCodec,
  deckKeys: ['generic'],        // one deck slot
  filterKeys: ['generic'],      // one set of filters
  defaultDeckType: 'generic',
  slotExtras(){ return {}; },   // fields a deck holds beyond name / cards / order
  isTypeEligible(card){ return true; },  // may this card go in the deck being edited?
  isLegal(card){ return true; },         // is it legal there (a stricter, soft check)?
  inActiveView(card){ return true; },    // does the card pool show it in the current view?
  defaultSort: 'name',
  aspectColors: {},                      // optional fixed colors for named card attributes
  afterCardsLoaded(){},                  // runs once a set's cards have been processed
  discordShare: false,                   // the feedback Discord channel is Echo's
  filterKey(){ return activeDeckKey(); },
  multiValueSplit: /[/,]/,
  commaSplits: true,
  keepRow(r){
    // Generic mode has no fixed type-prefix convention to filter rows by — the only
    // required column for ANY game is "id", so that's the only hard requirement.
    return String(r.id||'').trim() !== '';
  },
  tagCard(r){
    // Generic mode: a required "is-double-sided" column (TRUE/FALSE) and a required
    // "rotate" column (0/90/180/270, defaulting to 0) — the data-driven equivalent
    // of a structured game's hardcoded rotation rules.
    r._doubleSided = String(r['is-double-sided']).trim().toUpperCase()==='TRUE';
    // The sheet's "rotate" (written by the Card Updater) is how far the image must
    // turn clockwise to read upright. _rotate counts the other way (90 is turned
    // counter-clockwise — see .rotate-90-fill), so 90 and 270 swap.
    const rot = parseInt(r.rotate, 10);
    r._rotate = rot===90 ? 270 : rot===270 ? 90 : rot===180 ? 180 : 0;
    r._isHorizontal = (r._rotate===90 || r._rotate===270);
  },
  copyLimit(card){ return Infinity; }, // generic mode restricts card counts for no reason at all
  deckSummary(){
    // Generic mode doesn't restrict card counts for any reason — just show the total.
    const n = deckTotalCount();
    return { title: 'Your Deck', text: `${n} card${n!==1?'s':''}`, bad: false };
  },
  // Which cards the deck panel and library tiles count / remove: the one deck.
  listCount(id){ return curDeck().deckCards.get(id)||0; },
  removeOne(id){ removeOneCopy(id); },
  illegalHint: 'Not legal for this deck.',
  illegalRowHint: 'Not legal for this deck.',
  // A second list the deck panel can be editing instead of the main deck (a side deck…) —
  // null, or an object with render(zone) / has(id) / order() / setOrder(arr) / removeOne(id) / removeAll(id) / add(ids).
  activeSideList(){ return null; },
  // Which list a given card lives in — the same shape as activeSideList, or null for the main
  // deck. A game whose panel shows several lists at once answers per card, so a row's own
  // buttons always act on its own list whichever one is open.
  listOf(id){ return this.activeSideList(); },
  // Optional extras a structured game draws around the deck panel — none for a plain card pool.
  renderTabs(){},
  renderDeckControlsExtras(){},
  renderViewStats(){},
  renderDeckList: null,
};


// Which definition owns the cards that just loaded. Other definitions register
// themselves in `gameDefinitions` (see the private Echo file); anything nobody
// claims is a plain generic card pool.
const gameDefinitions = [];
function pickGame(rawSetResults){
  return gameDefinitions.find(g=> g.matches && g.matches(rawSetResults)) || GenericGame;
}
// What the page assumes before the first load finishes, so nothing flashes into the
// wrong styling. Private builds register their own definition first.
function defaultGame(){ return gameDefinitions[0] || GenericGame; }

state.game = defaultGame();
state.deckType = state.game.defaultDeckType; state.sortField = state.game.defaultSort; freshDeckState();
