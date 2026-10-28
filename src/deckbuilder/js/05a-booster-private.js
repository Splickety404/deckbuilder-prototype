/* =========================================================================
   UNWRAP A BOOSTER (private). Opens one booster and ADDS its cards to the
   Overlord and Champion decks (and the Overlord scheme list) — nothing already
   in a deck is removed, so it can be clicked as many times as you like.
   Slot layout: 3 Champion Commons, 4 Overlord Commons, 2 Champion + 2 Overlord Uncommons (the 2nd of
   each may roll Rare), 1 Rare (may roll Legendary), 1 Scheme. One pack in three is "special": it has
   3 Overlord Commons instead of 4, plus a foil card.
   The slot rules themselves live in src/shared/js/booster-rules-private.js.
   ========================================================================= */
function openBooster(setName){
  // What's in the pack is decided by rollBooster (src/shared/js/booster-rules-private.js, also used
  // by the booster generation script); everything below just deals the cards into the decks.
  const roll = rollBooster(state.cards, setName);
  if(roll.error){ toast(roll.error); return; }
  const pulled = roll.pulled;

  // Deal them out. A leader / Domination-Quest / Stronghold-Resistance goes into its own slot if
  // that slot is empty, otherwise it's added to the deck list as an extra (flagged in the rules
  // checklist).
  let extras = 0;
  const moves = []; // where each card is headed, for the fly-in animation (05d)
  FlyCards.begin();
  pulled.forEach(({card, foil})=>{
    const side = card.type.startsWith('O - ') ? 'overlord' : 'champion';
    const deck = state.decks[side];
    if(foil) deck.foilIds.add(card.id);
    if(card.type==='O - Scheme'){ deck.schemeIds.push(card.id); moves.push({card, key:'scheme', foil}); return; }
    const own = [['leaderId', leaderTypeName(side), 'deck-leader-slot'],
                 ['bonusCardId', bonusCardTypeName(side), 'deck-bonus-slot'],
                 ['extraCardId', extraCardTypeName(side), 'deck-extra-slot']].find(([,type])=>card.type===type);
    if(own){
      if(!deck[own[0]]){
        deck[own[0]] = card.id;
        if(own[0]==='bonusCardId') deck.bonusAspect = card.aspect || deck.bonusAspect;
        moves.push({card, side, slot:own[2], foil}); return;
      }
      extras++;
    }
    deck.deckCards.set(card.id, (deck.deckCards.get(card.id)||0)+1);
    if(!deck.deckOrder.includes(card.id)) deck.deckOrder.push(card.id);
    moves.push({card, key:side, foil});
  });
  renderAll();
  FlyCards.run(document.getElementById('btnUnwrapBooster'), moves);
  const foilCard = pulled.find(p=>p.foil);
  if(extras) toast(`Your booster had ${extras} extra leader/setup card${extras>1?'s':''} — you now have more than one in a deck. Remove one any time.`);
  else if(foilCard) toast(`Special booster! ✦ Foil: ${foilCard.card.name}`);
  else toast('Booster opened — cards added to your decks.');
}

document.getElementById('btnUnwrapBooster').addEventListener('click', ()=>{
  // A game with its own pack rules (HellBreak, 12c) supplies openBooster; Echo uses the one above.
  const open = state.game.openBooster || openBooster;
  // With more than one set loaded, ask every time which set the pack comes from.
  const sets = allSetNames();
  if(sets.length===1){ open(sets[0]); return; }
  openSealedSetPicker(open, 'The booster\'s cards will be drawn from this set only.');
});
