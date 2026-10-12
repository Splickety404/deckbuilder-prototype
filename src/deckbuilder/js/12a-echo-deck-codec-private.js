/* =========================================================================
   ECHO DECK CODEC (private) — Echo's deck shape in every deck file: leader,
   Domination/Quest, Stronghold/Resistance, the aspect they set, and the scheme
   deck. This is also what the live site writes for free-form games (their
   leader/scheme fields are simply empty), so existing saved decks, .json/.txt
   files and the room's deck import keep working exactly as before — both
   games point at this one codec in the private build. See DECK CODEC in 01b. */
const EchoDeckCodec = {
  saveExtras(d){
    return { overlordMode: d.overlordMode, leaderId: d.leaderId, bonusCardId: d.bonusCardId, extraCardId: d.extraCardId,
             bonusAspect: d.bonusAspect, schemeIds: d.schemeIds };
  },
  applySaved(saved, d){
    d.overlordMode = saved.overlordMode||'main';
    d.leaderId=saved.leaderId; d.bonusAspect=saved.bonusAspect||'';
    d.bonusCardId=saved.bonusCardId||null; d.extraCardId=saved.extraCardId||null;
    d.schemeIds = saved.schemeIds||[];
  },
  jsonFields(d){
    return {
      leaderId: d.leaderId,
      leaderName: getLeader()?getLeader().name:null,
      bonusCardId: d.bonusCardId,
      bonusCardName: getBonusCard()?getBonusCard().name:null,
      extraCardId: d.extraCardId,
      extraCardName: getExtraCard()?getExtraCard().name:null,
      bonusAspect: d.bonusAspect,
      schemeIds: d.schemeIds,
    };
  },
  applyJson(file, d){
    d.overlordMode='main';
    d.leaderId = file.leaderId || null;
    d.bonusCardId = file.bonusCardId || null;
    d.extraCardId = file.extraCardId || null;
    d.bonusAspect = file.bonusAspect || '';
    d.schemeIds = file.schemeIds || [];
  },
  textSetupLines(d){
    const leader = getLeader();
    const bonusCard = getBonusCard();
    const extraCard = getExtraCard();
    const isOverlord = state.deckType==='overlord';
    const lines = [];
    if(leader) lines.push(`Leader: ${leader.name}`);
    if(bonusCard) lines.push(`${isOverlord?'Domination':'Quest'}: ${bonusCard.name}`);
    if(extraCard) lines.push(`${isOverlord?'Stronghold':'Resistance'}: ${extraCard.name}`);
    if(d.bonusAspect) lines.push(`${isOverlord?'Domination':'Quest'} Aspect: ${d.bonusAspect}`);
    return lines;
  },
  textSchemeLines(d){
    const lines = [];
    if(state.deckType==='overlord' && d.schemeIds.length){
      lines.push('Schemes:');
      d.schemeIds.forEach(id=>{ const c=state.byId.get(id); if(c) lines.push(`1x ${c.name}`); });
      lines.push('');
    }
    return lines;
  },
  parseTextLine(line, ctx){
    if(!ctx.schemeNames) ctx.schemeNames = [];
    if(/^leader:/i.test(line)){ ctx.leaderName = line.split(':').slice(1).join(':').trim(); return true; }
    if(/^(domination|quest):/i.test(line)){ ctx.bonusCardName = line.split(':').slice(1).join(':').trim(); return true; }
    if(/^(stronghold|resistance):/i.test(line)){ ctx.extraCardName = line.split(':').slice(1).join(':').trim(); return true; }
    if(/aspect:/i.test(line)){ ctx.bonusAspectVal = line.split(':').slice(1).join(':').trim(); return true; }
    if(/^schemes:/i.test(line)){ ctx.section='schemes'; return true; }
    return false;
  },
  parseTextItem(ctx, m){
    if(ctx.section==='schemes'){ ctx.schemeNames.push(m[2].trim()); return true; }
    return false;
  },
  finishTextImport(ctx, byName, unmatched){
    const leaderName = ctx.leaderName || null, bonusCardName = ctx.bonusCardName || null, extraCardName = ctx.extraCardName || null;
    const bonusAspectVal = ctx.bonusAspectVal || '', schemeNames = ctx.schemeNames || [];
    const leaderCard = leaderName ? state.cards.find(c=>c.name===leaderName && (c.type==='O - Overlord'||c.type==='C - Champion')) : null;
    if(leaderName && !leaderCard) unmatched.push(leaderName);

    state.deckType = leaderCard ? (leaderCard.type==='O - Overlord'?'overlord':'champion') : state.deckType;
    curDeck().overlordMode = 'main';
    curDeck().leaderId = leaderCard ? leaderCard.id : null;

    const bonusCard = bonusCardName ? byName.get(bonusCardName) : null;
    if(bonusCardName && !bonusCard) unmatched.push(bonusCardName);
    curDeck().bonusCardId = bonusCard ? bonusCard.id : null;
    // Prefer the derived value from the matched card, same as everywhere else this is
    // set — the explicit "Aspect:" line is only a fallback, e.g. for older exported
    // files from before this card-driven derivation existed.
    curDeck().bonusAspect = bonusCard ? (bonusCard.aspect||'') : bonusAspectVal;

    const extraCard = extraCardName ? byName.get(extraCardName) : null;
    if(extraCardName && !extraCard) unmatched.push(extraCardName);
    curDeck().extraCardId = extraCard ? extraCard.id : null;

    curDeck().schemeIds = [];
    schemeNames.forEach(n=>{ const c=byName.get(n); c ? curDeck().schemeIds.push(c.id) : unmatched.push(n); });
  },
  csvFiles(){
    if(!state.game.structured){
      // No leader/setup slots to prepend in generic mode — just the deck itself.
      return [{ suffix: '_playingcardsio.csv', cards: expandedDeckList() }];
    }
    const leader = getLeader();
    if(!leader) return { error: 'Choose a leader first.' };
    const setupCards = [leader, getBonusCard(), getExtraCard()].filter(Boolean);
    if(state.deckType==='overlord'){
      // Two separate files: the Overlord deck (leader, Domination, Stronghold, then the
      // 50-card deck) and the scheme deck (just the 5 schemes) — matching how you'd
      // actually build these as two distinct decks on playingcards.io.
      const schemeList = curDeck().schemeIds.map(id=>state.byId.get(id)).filter(Boolean);
      return [
        { suffix: '_overlord_playingcardsio.csv', cards: [...setupCards, ...expandedDeckList()] },
        { suffix: '_schemes_playingcardsio.csv', cards: schemeList },
      ];
    }
    return [{ suffix: '_playingcardsio.csv', cards: [...setupCards, ...expandedDeckList()] }];
  },
  printLead(d){
    const lead = [getLeader(), getBonusCard(), getExtraCard()];
    if(state.deckType==='overlord') d.schemeIds.forEach(id=> lead.push(state.byId.get(id)));
    return lead;
  },
  referencedIds(d){ return [d.leaderId, d.bonusCardId, d.extraCardId, ...d.schemeIds]; },
};
EchoGame.deckCodec = EchoDeckCodec;
// Private build only: free-form games keep the live site's deck shape (same slots, extras and files).
GenericGame.deckCodec = EchoDeckCodec;
GenericGame.deckKeys = EchoGame.deckKeys;
GenericGame.filterKeys = EchoGame.filterKeys;
GenericGame.defaultDeckType = EchoGame.defaultDeckType;
GenericGame.slotExtras = EchoGame.slotExtras;
GenericGame.aspectColors = EchoGame.aspectColors; // the live site tints every game's fallback card faces with these
