/* =========================================================================
   ECHO OF OMENS GAME DEFINITION (private) — leaders, Domination/Quest cards,
   aspects, schemes, a 3-copy limit and a 50-card deck. See GAME DEFINITIONS
   in 01b for what each member means. Everything here is the old Echo branch
   of the code, moved unchanged. Registered first, so it is also the default. */
const DECK_LIMIT = 50;
const MAX_COPIES = 3;
const SCHEME_DECK_SIZE = 5;
// The deck panel is split into sections (Overlord / Domination / Stronghold / Schemes / Deck, or
// Champion / Quest / Resistance / Deck); clicking one shows the cards that can go in it. Which one
// is open is remembered per deck: 'leader' | 'bonus' | 'extra' | 'schemes' | 'deck'.
const echoOpenSection = { overlord:'deck', champion:'deck' };
function echoActiveSection(){ return echoOpenSection[state.deckType] || 'deck'; }
// True while the Overlord's Schemes section is open (adding then goes to the scheme list).
function activeIsSchemeMode(){ return state.game.structured && state.deckType==='overlord' && echoActiveSection()==='schemes'; }

const EchoGame = {
  id: 'echo',
  structured: true,
  aspectColors: { 'Corruption':'#6b3fa0','Wrath':'#a03f3f','Deceit':'#3f8f7a' },
  afterCardsLoaded(){ computeAndCacheAspects(); },
  deckKeys: ['overlord', 'champion', 'generic'],
  filterKeys: ['overlord', 'champion', 'scheme', 'generic',
               'overlord-leader', 'overlord-bonus', 'overlord-extra', 'champion-leader', 'champion-bonus', 'champion-extra'],
  defaultDeckType: 'overlord',
  // Overlord and Champion are built entirely independently — separate leader, aspect, scheme
  // deck, main deck and name.
  slotExtras(){
    return {
      leaderId:null, schemeIds:[], overlordMode:'main',
      bonusCardId:null,  // O - Domination (Overlord) / C - Quest (Champion) — its aspect drives bonusAspect below
      extraCardId:null,  // O - Stronghold (Overlord) / C - Resistance (Champion), or the Z-Custom placeholder until real cards exist
      foilIds:new Set(), // cards in this deck that are foil (from a special booster) — display + PDF texture only
      bonusAspect:'',    // derived from bonusCardId's aspect whenever it's set — never chosen independently anymore
    };
  },
  // Every section of a deck is a different card pool with different useful filters, so each gets
  // its own bucket (the main deck keeps the deck's own key, the Overlord's Schemes keep 'scheme').
  filterKey(){
    const sec = echoActiveSection();
    if(sec==='deck') return activeDeckKey();
    if(sec==='schemes') return 'scheme';
    return activeDeckKey() + '-' + sec;
  },
  multiValueSplit: '/',
  commaSplits: false,
  matches(rawSetResults){
    // Echo's presentation is recognised by an "O - Overlord" type value anywhere in the loaded rows.
    return rawSetResults.some(s => s.rows.some(r => String(r.type||'').trim() === 'O - Overlord'));
  },
  keepRow(r){
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
  },
  tagCard(r){
    r._doubleSided = String(r.is_double_sided).trim().toUpperCase()==='TRUE';
    // The sheet splits ability text 4 ways (Champion/Overlord x stage 1/2), but a card
    // only ever has one side's version — so users just see one "Ability", with stage 2
    // appended the same "Stage 2: ..." way the old single column wrote it. A sheet that
    // still has only the old `ability` column passes through unchanged.
    const txt = k => String(r[k]||'').trim();
    const stage1 = txt('ability') || txt('ability-overlord');
    const stage2 = txt('ability-stage-2') || txt('ability-overlord-stage-2');
    r.ability = stage2 ? (stage1 ? stage1 + ' ' : '') + 'Stage 2: ' + stage2 : stage1;
    r._isScheme = r.type==='O - Scheme';
    // These 4 are physically the same portrait-cut card as everything else, with
    // content printed sideways — same treatment as schemes: rotated on screen for
    // readability, printed at their native orientation (exports never rotate at all,
    // so nothing extra is needed there).
    r._isHorizontal = r._isScheme || HORIZONTAL_TYPES.has(r.type) ||
      (r.type==='Z - Custom' && Object.values(EXTRA_CARD_PLACEHOLDER_NAME).includes(r.name)); // the Stronghold/Resistance placeholders are horizontal too
    r._rotate = r._isHorizontal ? 90 : 0; // Echo mode always rotates its horizontal cards the same way it always has
  },
  copyLimit(card){
    if(card && card._isScheme) return 1; // schemes: documented 1-copy max
    const sec = card ? echoHomeSection(card) : 'deck';
    return (sec==='leader' || sec==='bonus' || sec==='extra') ? 1 : MAX_COPIES; // one leader / Domination / Stronghold
  },
  deckSummary(){
    const count = echoSectionCount('deck');
    return { title: 'Your Deck', text: `${count} / ${DECK_LIMIT}`, bad: count>DECK_LIMIT };
  },
  listCount(id){ const l = echoListOf(id); return l ? l.count(id) : (curDeck().deckCards.get(id)||0); },
  removeOne(id){ removeOneCopy(id); },
  illegalHint: 'Not legal for this deck — wrong aspect for your leader/domination aspect.',
  renderViewStats(){ renderCurrentViewStats(); },
  inActiveView(card){ return true; },
  defaultSort: 'card-cost',
  renderDeckList: null,
};
gameDefinitions.push(EchoGame);

state.game = defaultGame(); // Echo is registered first, so it is the default
state.deckType = state.game.defaultDeckType; state.sortField = state.game.defaultSort; freshDeckState();
