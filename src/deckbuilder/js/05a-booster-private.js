/* =========================================================================
   UNWRAP A BOOSTER (private). Opens one booster and ADDS its cards to the
   Overlord and Champion decks (and the Overlord scheme list) — nothing already
   in a deck is removed, so it can be clicked as many times as you like.
   Slot layout: 3 Champion Commons, 4 Overlord Commons, 2 Champion + 2 Overlord Uncommons (the 2nd of
   each may roll Rare), 1 Rare (may roll Legendary), 1 Scheme. One pack in three is "special": it has
   3 Overlord Commons instead of 4, plus a foil card.
   Reuses rarityTier / sagaDraw / isMainDeckEligibleType from the Saga generator.
   ========================================================================= */
const BOOSTER_UPGRADE_CHANCE = 0.10;   // an Uncommon slot may roll Rare; the Rare slot may roll Legendary
const BOOSTER_SPECIAL_CHANCE = 1/3;    // 1 pack in 3 swaps the 4th Overlord Common for a foil card
let boosterSetName = null; // the set you picked; remembered for the rest of the session

// Picks one card of a rarity from a pool, never repeating a card inside the same booster.
// `upgradeTo` (optional) is the rarity it has a 10% chance to become instead; if no card of the
// wanted rarity is left, the slot's base rarity is used, then any unused card from the pool
// (the slot is skipped only if the whole pool is used up).
function boosterPick(pool, tier, taken, upgradeTo){
  const unused = pool.filter(c=>!taken.has(c.id));
  const want = (upgradeTo && Math.random()<BOOSTER_UPGRADE_CHANCE) ? upgradeTo : tier;
  let cands = unused.filter(c=>rarityTier(c)===want);
  if(!cands.length) cands = unused.filter(c=>rarityTier(c)===tier);
  const c = randomOf(cands.length ? cands : unused);
  if(c) taken.add(c.id);
  return c;
}

function openBooster(setName){
  const bySet = (c) => (c._setNames && c._setNames.length) ? c._setNames.includes(setName) : c._setName===setName;
  const inSet = state.cards.filter(bySet);
  const champ = inSet.filter(c=>isMainDeckEligibleType(c,'champion'));
  const overl = inSet.filter(c=>isMainDeckEligibleType(c,'overlord'));
  const schemes = inSet.filter(c=>c.type==='O - Scheme');
  const mainPool = [...champ, ...overl];
  if(!mainPool.length){ toast('No cards found in that set.'); return; }
  const taken = new Set();
  const pulled = [];
  const slot = (pool, tier, upgradeTo, extra)=>{
    const c = boosterPick(pool, tier, taken, upgradeTo);
    if(c) pulled.push({card:c, ...extra});
  };

  const special = Math.random() < BOOSTER_SPECIAL_CHANCE;
  for(let i=0;i<3;i++) slot(champ, 'common');
  for(let i=0;i<(special?3:4);i++) slot(overl, 'common');
  slot(champ, 'uncommon');
  slot(champ, 'uncommon', 'rare');
  slot(overl, 'uncommon');
  slot(overl, 'uncommon', 'rare');
  slot(mainPool, 'rare', 'legendary');
  if(special){ // the foil: any card in the game (any set), shown foiled in the deckbuilder and printed with a shimmer texture
    const foilPool = state.cards.filter(c=>!taken.has(c.id) && /^[OC] - /.test(c.type));
    const f = randomOf(foilPool);
    if(f){ taken.add(f.id); pulled.push({card:f, foil:true}); }
  }
  // scheme slot: normal pull rates (65/30/5, Rare may upgrade to Legendary)
  const scheme = sagaDraw(schemes.filter(c=>!taken.has(c.id)));
  if(scheme){ taken.add(scheme.id); pulled.push({card:scheme}); }

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
  const sets = allSetNames();
  if(boosterSetName && sets.includes(boosterSetName)){ openBooster(boosterSetName); return; }
  if(sets.length===1){ boosterSetName = sets[0]; openBooster(boosterSetName); return; }
  openSealedSetPicker((setName)=>{ boosterSetName = setName; openBooster(setName); });
});
