/* =========================================================================
   UNWRAP A BOOSTER (private). Opens one booster and ADDS its cards to the
   Overlord and Champion decks (and the Overlord scheme list) — nothing already
   in a deck is removed, so it can be clicked as many times as you like.
   Reuses rarityTier / sagaDraw / isMainDeckEligibleType from the Saga generator.
   ========================================================================= */
const BOOSTER_RARITY_ROLLS = {
  uncommonOrRare:  { uncommon:90, rare:10 },
  rareOrLegendary: { rare:90, legendary:10 },
  wild:            { legendary:3, rare:6, uncommon:31, common:60 },
};
let boosterSetName = null; // the set you picked; remembered for the rest of the session

function boosterRoll(weights, available){
  const tiers = Object.keys(weights).filter(t=>available.has(t));
  if(!tiers.length) return null;
  let r = Math.random()*tiers.reduce((s,t)=>s+weights[t],0);
  for(const t of tiers){ r -= weights[t]; if(r<=0) return t; }
  return tiers[tiers.length-1];
}
// Picks n cards of one rarity (or, with a weights table, a rolled rarity per card) from a pool,
// never repeating a card inside the same booster. If every card of the wanted rarity is already
// in the pack, any other unused card from the pool is used instead (or the slot is skipped
// in the unlikely case the whole pool is used up).
function boosterPicks(pool, n, rarity, taken){
  const out = [];
  for(let i=0;i<n;i++){
    let tier = rarity;
    if(typeof rarity==='object') tier = boosterRoll(rarity, new Set(pool.map(rarityTier)));
    const unused = pool.filter(c=>!taken.has(c.id));
    const ofTier = unused.filter(c=>rarityTier(c)===tier);
    const c = randomOf(ofTier.length ? ofTier : unused);
    if(!c) continue;
    taken.add(c.id);
    out.push(c);
  }
  return out;
}

function openBooster(setName){
  const bySet = (c) => (c._setNames && c._setNames.length) ? c._setNames.includes(setName) : c._setName===setName;
  const inSet = state.cards.filter(bySet);
  const champ = inSet.filter(c=>isMainDeckEligibleType(c,'champion'));
  const overl = inSet.filter(c=>isMainDeckEligibleType(c,'overlord'));
  const schemes = inSet.filter(c=>c.type==='O - Scheme');
  const leaders = inSet.filter(c=>c.type===leaderTypeName('overlord') || c.type===leaderTypeName('champion'));
  const mainPool = [...champ, ...overl];
  if(!mainPool.length){ toast('No cards found in that set.'); return; }
  const taken = new Set();
  const pulled = [];
  const add = (cards, label)=> cards.forEach(c=>pulled.push({card:c, label}));

  add(boosterPicks(champ, 3, 'common', taken), 'Common');
  add(boosterPicks(overl, 4, 'common', taken), 'Common');
  add(boosterPicks(champ, 1, 'uncommon', taken), 'Uncommon');
  add(boosterPicks(overl, 1, 'uncommon', taken), 'Uncommon');
  add(boosterPicks(mainPool, 1, BOOSTER_RARITY_ROLLS.uncommonOrRare, taken), 'Uncommon / Rare slot');
  add(boosterPicks(mainPool, 1, BOOSTER_RARITY_ROLLS.rareOrLegendary, taken), 'Rare / Legendary slot');
  // scheme slot: normal pull rates (65/30/5, Rare may upgrade to Legendary)
  const scheme = sagaDraw(schemes.filter(c=>!taken.has(c.id)));
  if(scheme){ taken.add(scheme.id); pulled.push({card:scheme, label:'Scheme'}); }
  add(boosterPicks([...mainPool, ...schemes, ...leaders], 1, BOOSTER_RARITY_ROLLS.wild, taken), 'Wild slot');

  // Deal them out. A leader goes in as the deck's leader if that side has none yet, otherwise
  // it's added to the deck list as an extra (flagged in the rules checklist).
  let extraLeaders = 0;
  pulled.forEach(({card})=>{
    const side = card.type.startsWith('O - ') ? 'overlord' : 'champion';
    const slot = state.decks[side];
    if(card.type==='O - Scheme'){ slot.schemeIds.push(card.id); return; }
    if(card.type===leaderTypeName(side)){
      if(!slot.leaderId){ slot.leaderId = card.id; return; }
      extraLeaders++;
    }
    slot.deckCards.set(card.id, (slot.deckCards.get(card.id)||0)+1);
    if(!slot.deckOrder.includes(card.id)) slot.deckOrder.push(card.id);
  });
  renderAll();
  showBoosterResults(pulled);
  if(extraLeaders) toast(`Your booster had ${extraLeaders} extra Overlord/Champion card${extraLeaders>1?'s':''} — you now have more than one in a deck. Remove one any time.`);
  else toast('Booster opened — cards added to your decks.');
}

function showBoosterResults(pulled){
  const rows = pulled.map(({card,label})=>{
    const side = card.type.startsWith('O - ') ? 'Overlord' : 'Champion';
    return `<div class="row-item"><span>${escapeHtml(card.name)} <span style="color:var(--text-soft);font-size:12px;">— ${escapeHtml(card.type.replace(/^[OC] - /,''))}, ${escapeHtml(rarityTier(card))}</span></span><span style="color:var(--text-soft);font-size:12px;">${side}</span></div>`;
  }).join('');
  document.getElementById('boosterResultList').innerHTML = rows;
  document.getElementById('boosterModal').classList.remove('hidden');
}

document.getElementById('btnUnwrapBooster').addEventListener('click', ()=>{
  const sets = allSetNames();
  if(boosterSetName && sets.includes(boosterSetName)){ openBooster(boosterSetName); return; }
  if(sets.length===1){ boosterSetName = sets[0]; openBooster(boosterSetName); return; }
  openSealedSetPicker((setName)=>{ boosterSetName = setName; openBooster(setName); });
});
