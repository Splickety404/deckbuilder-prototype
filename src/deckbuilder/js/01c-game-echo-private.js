/* =========================================================================
   ECHO OF OMENS GAME DEFINITION (private) — leaders, Domination/Quest cards,
   aspects, schemes, a 3-copy limit and a 50-card deck. See GAME DEFINITIONS
   in 01b for what each member means. Everything here is the old Echo branch
   of the code, moved unchanged. Registered first, so it is also the default. */
const EchoGame = {
  id: 'echo',
  structured: true,
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
    r._isScheme = r.type==='O - Scheme';
    // These 4 are physically the same portrait-cut card as everything else, with
    // content printed sideways — same treatment as schemes: rotated on screen for
    // readability, printed at their native orientation (exports never rotate at all,
    // so nothing extra is needed there).
    r._isHorizontal = r._isScheme || HORIZONTAL_TYPES.has(r.type) ||
      (r.type==='Z - Custom' && Object.values(EXTRA_CARD_PLACEHOLDER_NAME).includes(r.name)); // the Stronghold/Resistance placeholders are horizontal too
    r._rotate = r._isHorizontal ? 90 : 0; // Echo mode always rotates its horizontal cards the same way it always has
  },
  copyLimit(card){ return (card && card._isScheme) ? 1 : MAX_COPIES; }, // schemes: documented 1-copy max
  deckSummary(){
    const isScheme = activeIsSchemeMode();
    const count = isScheme ? curDeck().schemeIds.length : deckTotalCount();
    const limit = isScheme ? SCHEME_DECK_SIZE : DECK_LIMIT;
    return { title: isScheme ? 'Scheme Deck' : 'Your Deck', text: `${count} / ${limit}`, bad: count>limit };
  },
  listCount(id){ return activeIsSchemeMode() ? curDeck().schemeIds.filter(x=>x===id).length : (curDeck().deckCards.get(id)||0); },
  removeOne(id){ activeIsSchemeMode() ? removeScheme(id) : removeOneCopy(id); },
  illegalHint: 'Not legal for this deck — wrong aspect for your leader/domination aspect.',
  renderViewStats(){ renderCurrentViewStats(); },
  backUrl(card){
    if(card.type === 'O - Scheme') return state.genericBacks.schemeBackUrl || '';
    if(card.type.startsWith('O -')) return state.genericBacks.overlordBackUrl || '';
    if(card.type.startsWith('C -')) return state.genericBacks.championBackUrl || '';
    return '';
  },
};
gameDefinitions.push(EchoGame);

state.game = defaultGame(); // Echo is registered first, so it is the default
