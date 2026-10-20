/* =========================================================================
   BOOSTER PACK RULES (private) — the ONE place the booster slot layout lives. Pure rules, no app
   state: callers pass in the cards. Used by the deckbuilder's "Unwrap a Booster" button
   (05a-booster-private.js) and by generated-decks/generate-boosters.js. Reuses rarityTier / sagaDraw /
   randomOf / isMainDeckEligibleType from sealed-rules-private.js (loaded first).

   Regular pack (13 cards):
     3 Champion Common · 4 Overlord Common · 1 Champion Uncommon · 1 Champion Uncommon (10% Rare) ·
     1 Overlord Uncommon · 1 Overlord Uncommon (10% Rare) · 1 Rare for either side (10% Legendary) · 1 Scheme
   Special pack (1 in 3, 13 cards): the same, but 3 Overlord Commons instead of 4, plus 1 foil card
     (any Overlord/Champion card in the whole game, any set).
   No card appears twice in one pack. Overlord / Champion slots never hold a Scheme, leader, or
   Domination/Quest/Stronghold/Resistance card (isMainDeckEligibleType).
   ========================================================================= */
const BOOSTER_UPGRADE_CHANCE = 0.10;   // an Uncommon slot may roll Rare; the Rare slot may roll Legendary
const BOOSTER_SPECIAL_CHANCE = 1/3;    // 1 pack in 3 is "special" (has a foil)

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

// Rolls one booster from `cards` (every card the caller can see) for the set named `setName`.
// Returns { pulled:[{card, label, foil?}], special } in slot order, or { error }.
// `special` forces (true) or forbids (false) a special pack; leave it undefined for the 1-in-3 roll.
function rollBooster(cards, setName, special){
  const bySet = (c) => (c._setNames && c._setNames.length) ? c._setNames.includes(setName) : c._setName===setName;
  const inSet = cards.filter(bySet);
  const champ = inSet.filter(c=>isMainDeckEligibleType(c,'champion'));
  const overl = inSet.filter(c=>isMainDeckEligibleType(c,'overlord'));
  const schemes = inSet.filter(c=>c.type==='O - Scheme');
  const mainPool = [...champ, ...overl];
  if(!mainPool.length) return { error:'No cards found in that set.' };
  const taken = new Set();
  const pulled = [];
  const slot = (pool, tier, upgradeTo, label)=>{
    const c = boosterPick(pool, tier, taken, upgradeTo);
    if(c) pulled.push({card:c, label});
  };

  if(special===undefined) special = Math.random() < BOOSTER_SPECIAL_CHANCE;
  for(let i=0;i<3;i++) slot(champ, 'common', null, 'Champion Common');
  for(let i=0;i<(special?3:4);i++) slot(overl, 'common', null, 'Overlord Common');
  slot(champ, 'uncommon', null, 'Champion Uncommon');
  slot(champ, 'uncommon', 'rare', 'Champion Uncommon (10% Rare)');
  slot(overl, 'uncommon', null, 'Overlord Uncommon');
  slot(overl, 'uncommon', 'rare', 'Overlord Uncommon (10% Rare)');
  slot(mainPool, 'rare', 'legendary', 'Rare (10% Legendary)');
  if(special){ // the foil: any card in the game (any set)
    const foilPool = cards.filter(c=>!taken.has(c.id) && /^[OC] - /.test(c.type));
    const f = randomOf(foilPool);
    if(f){ taken.add(f.id); pulled.push({card:f, label:'Foil', foil:true}); }
  }
  // scheme slot: normal pull rates (65/30/5, Rare may upgrade to Legendary)
  const scheme = sagaDraw(schemes.filter(c=>!taken.has(c.id)));
  if(scheme){ taken.add(scheme.id); pulled.push({card:scheme, label:'Scheme'}); }
  return { pulled, special };
}
