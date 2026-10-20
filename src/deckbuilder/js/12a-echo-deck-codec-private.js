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
             bonusAspect: d.bonusAspect, schemeIds: d.schemeIds, foilIds: [...d.foilIds] };
  },
  applySaved(saved, d){
    d.overlordMode = saved.overlordMode||'main';
    d.leaderId=saved.leaderId; d.bonusAspect=saved.bonusAspect||'';
    d.bonusCardId=saved.bonusCardId||null; d.extraCardId=saved.extraCardId||null;
    d.schemeIds = saved.schemeIds||[];
    d.foilIds = new Set(saved.foilIds||[]);
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
      foilIds: [...d.foilIds],
    };
  },
  applyJson(file, d){
    d.overlordMode='main';
    d.leaderId = file.leaderId || null;
    d.bonusCardId = file.bonusCardId || null;
    d.extraCardId = file.extraCardId || null;
    d.bonusAspect = file.bonusAspect || '';
    d.schemeIds = file.schemeIds || [];
    d.foilIds = new Set(file.foilIds || []);
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
  textSideListLines(d){
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
    if(ctx.section==='schemes'){ for(let i=0;i<(Number(m[1])||1);i++) ctx.schemeNames.push(m[2].trim()); return true; }
    return false;
  },
  finishTextImport(ctx, byName, unmatched){
    if(!ctx.leaderName && ctx.deckLines){
      // No "Leader:" line (e.g. a bare pasted list) — the first Overlord/Champion card is the leader.
      const i = ctx.deckLines.findIndex(l=>{ const c=byName.get(l.name); return c && (c.type==='O - Overlord'||c.type==='C - Champion'); });
      if(i>=0) ctx.leaderName = byName.get(ctx.deckLines.splice(i,1)[0].name).name;
    }
    ctx.warnings = ctx.warnings || [];
    if(ctx.deckLines){
      // Any scheme named in the list (no "Schemes:" section needed) goes to the scheme deck, not
      // the main deck. Repeats are kept as listed; the rules warning below tells the user.
      ctx.schemeNames = ctx.schemeNames || [];
      ctx.deckLines = ctx.deckLines.filter(l=>{
        const c = byName.get(l.name);
        if(c && c._isScheme){ for(let i=0;i<l.count;i++) ctx.schemeNames.push(c.name); return false; }
        return true;
      });
      // Domination/Quest and Stronghold/Resistance: the first one found becomes the deck's single
      // chosen card for that slot; any extra copies (or a second different one) stay in the main deck.
      const claim = (types, key, label)=>{
        for(const l of ctx.deckLines){
          const c = byName.get(l.name);
          if(!c || !types.includes(c.type)) continue;
          if(!ctx[key]){ ctx[key] = c.name; l.count -= 1; }
          if(l.count>0) ctx.warnings.push(`${l.count} extra ${c.name} (${label} is limited to 1 and was left in the main deck)`);
        }
        ctx.deckLines = ctx.deckLines.filter(l=>l.count>0);
      };
      claim(['O - Domination','C - Quest'], 'bonusCardName', 'Domination/Quest');
      claim(['O - Stronghold','C - Resistance'], 'extraCardName', 'Stronghold/Resistance');
    }
    if(ctx.schemeNames && new Set(ctx.schemeNames).size < ctx.schemeNames.length) ctx.warnings.push('the same scheme is listed more than once');
    if(ctx.schemeNames && ctx.schemeNames.length > SCHEME_DECK_SIZE) ctx.warnings.push(`${ctx.schemeNames.length} schemes (limit ${SCHEME_DECK_SIZE})`);
    const leaderName = ctx.leaderName || null, bonusCardName = ctx.bonusCardName || null, extraCardName = ctx.extraCardName || null;
    const bonusAspectVal = ctx.bonusAspectVal || '', schemeNames = ctx.schemeNames || [];
    const leaderCard = leaderName ? state.cards.find(c=>c.name===(byName.get(leaderName)||{}).name && (c.type==='O - Overlord'||c.type==='C - Champion')) : null;
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
