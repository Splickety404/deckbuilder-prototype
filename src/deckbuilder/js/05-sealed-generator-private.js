/* =========================================================================
   SEALED DECK GENERATOR
   ========================================================================= */
const RARITY_WEIGHTS = { legendary:1, rare:8, uncommon:26, common:65 };
function rarityTier(card){
  const r = String(card.rarity||'').trim().toLowerCase();
  return RARITY_WEIGHTS.hasOwnProperty(r) ? r : 'common'; // unspecified rarity counts as common
}
// Per-card weight within a specific pool, renormalized so tiers absent from the pool
// simply don't consume any probability mass (the remaining tiers' percentages scale up
// to fill the gap) rather than that mass being wasted or crashing on an empty tier.
function cardWeightWithin(card, pool){
  const tier = rarityTier(card);
  const countInTier = pool.filter(c=>rarityTier(c)===tier).length;
  return countInTier ? RARITY_WEIGHTS[tier]/countInTier : 0;
}
// Precomputes tier counts once (O(n)) rather than recomputing per-card via
// cardWeightWithin (which is itself O(n), making naive repeated use O(n²)) — the hot
// paths below (weightedRandomPick, pickPairWithCostSum) use this instead.
function makeWeightFn(pool){
  const tierCounts = {};
  pool.forEach(c=>{ const t=rarityTier(c); tierCounts[t]=(tierCounts[t]||0)+1; });
  return (card) => { const t=rarityTier(card); return tierCounts[t] ? RARITY_WEIGHTS[t]/tierCounts[t] : 0; };
}
function weightedRandomPick(pool){
  if(!pool.length) return null;
  const weightOf = makeWeightFn(pool);
  const total = pool.reduce((s,c)=>s+weightOf(c), 0);
  if(total<=0) return pool[Math.floor(Math.random()*pool.length)];
  let r = Math.random()*total;
  for(const c of pool){
    r -= weightOf(c);
    if(r<=1e-9) return c;
  }
  return pool[pool.length-1];
}
// Draws n cards, WITH replacement by default (repeats allowed — matches "choose N random
// cards" with no distinctness stated), or without when the slot conventionally wants
// unique picks (schemes).
function weightedRandomPickMany(pool, n, withoutReplacement){
  const picks=[];
  let remaining = withoutReplacement ? [...pool] : pool;
  for(let i=0;i<n;i++){
    if(!remaining.length) break;
    const c = weightedRandomPick(remaining);
    if(!c) break;
    picks.push(c);
    if(withoutReplacement) remaining = remaining.filter(x=>x.id!==c.id);
  }
  return picks;
}
// Draws n cards one at a time, re-checking the cap after each — so a card that's already
// at the cap (whether from earlier in this SAME draw or from something added before it,
// like the guaranteed lieutenant pair) is excluded from the remaining draws, without
// otherwise restricting the pool.
function weightedRandomPickCapped(pool, n, slot, cap){
  const picks = [];
  for(let i=0;i<n;i++){
    const eligible = pool.filter(c => (slot.deckCards.get(c.id)||0) < cap);
    if(!eligible.length) break;
    const c = weightedRandomPick(eligible);
    if(!c) break;
    picks.push(c);
    sealedIncrementDeckCard(slot, c.id);
  }
  return picks;
}
function sealedCostOf(card){
  const n = Number(card['card-cost']);
  return isNaN(n) ? null : n;
}
// Picks 2 cards whose costs sum to one of validSums, rarity-weighted over all valid
// pairs (repeats of the same card allowed). Falls back to 2 unconstrained weighted
// picks if the pool has no such pair at all, rather than failing outright.
function pickPairWithCostSum(pool, validSums){
  const withCost = pool.filter(c=>sealedCostOf(c)!==null);
  const weightOf = makeWeightFn(withCost);
  const pairs = [];
  for(const a of withCost) for(const b of withCost){
    if(validSums.includes(sealedCostOf(a)+sealedCostOf(b))) pairs.push([a,b]);
  }
  if(pairs.length){
    const pairWeight = (p) => weightOf(p[0]) * weightOf(p[1]);
    const total = pairs.reduce((s,p)=>s+pairWeight(p),0);
    let r = Math.random()*total;
    for(const p of pairs){ r -= pairWeight(p); if(r<=1e-9) return p; }
    return pairs[pairs.length-1];
  }
  console.warn('Sealed deck: no lieutenant/ally pair summing to '+validSums.join(' or ')+' found — falling back to 2 unconstrained picks.');
  return weightedRandomPickMany(pool, 2);
}
// Mirrors isTypeEligible's main-deck branch, but independent of activeIsSchemeMode()/
// the current UI toggle state — generation shouldn't care which sub-tab happens to be
// showing when the button is clicked.
function isMainDeckEligibleType(card, deckType){
  const prefix = prefixFor(deckType);
  if(!card.type.startsWith(prefix)) return false;
  if(card.type===leaderTypeName(deckType)) return false;
  if(card.type===prefix+'Scheme') return false;
  if(card.type===bonusCardTypeName(deckType)) return false;
  if(card.type===extraCardTypeName(deckType)) return false;
  if(card.type==='Z - Custom') return false;
  return true;
}
function sealedIncrementDeckCard(slot, id){
  const cur = slot.deckCards.get(id)||0;
  slot.deckCards.set(id, cur+1);
  if(!slot.deckOrder.includes(id)) slot.deckOrder.push(id);
}
// A card drawn while ignoring aspect rules (steps 6-7) might be a scheme — those route
// to the scheme deck instead of the main deck, silently skipping an exact duplicate
// (schemeIds is a set everywhere else in the app; kept consistent here too) rather than
// adding the same scheme twice.
// A card drawn while ignoring aspect rules (steps 6-7) might be a scheme — those route
// to the scheme deck instead of the main deck. Duplicates here are fine (only the
// INITIAL 5 schemes in step 4 must be distinct from each other).
function sealedRouteCard(slot, card){
  if(card.type==='O - Scheme') slot.schemeIds.push(card.id);
  else sealedIncrementDeckCard(slot, card.id);
}

// Standalone version of isAspectLegal that doesn't read through curDeck()/getLeader() —
// needed because generateSealedDecks (below) builds the Overlord and Champion decks
// side by side in one pass, so "the current deck's leader" isn't a meaningful concept
// while it's running; this takes the leader/bonusAspect to check against explicitly.
function isAspectLegalFor(card, leader, bonusAspect){
  if(!leader) return false;
  if(isNeutral(card)) return true;
  if(card.loyalty==='Loyal') return card.aspect===leader.aspect;
  return card.aspect===leader.aspect || (bonusAspect && card.aspect===bonusAspect);
}

function deckCountOf(slot){ let n=0; for(const v of slot.deckCards.values()) n+=v; return n; }

/* "Get Sealed Decks" — builds the Overlord deck, the Champion deck, and the scheme
   deck all in one shot. Steps below are numbered to match the spec Seth gave:
     1. Leaders (Champion + Overlord).
     2. Domination/Quest, excluding whichever aspect matches that side's OWN leader.
     3. Stronghold/Resistance (only a Z-Custom placeholder exists today — see
        extraCardPool's own comment on that fallback).
     4. 30 cards per side, aspect-legal for that side's own leader/bonus card, capped
        at 2 copies of any one card — including a guaranteed lieutenant pair (Overlord)
        / ally pair (Champion) costing 9-or-10 combined, same as ever, with the
        remaining 28 slots filled respecting that same 2-copy cap (counting the pair).
     5. 5 DISTINCT Overlord schemes, aspect-legal — withoutReplacement guarantees no
        duplicates among these 5 specifically.
     6-9. 12 common + 6 uncommon + 2 rare-or-legendary + 4 any-rarity cards, ALL drawn
        from one shared pool of every O-/C- main-deck card AND every O-Scheme card in
        the set — aspect is intentionally ignored here (confirmed with Seth) and a
        scheme can land in any of these four draws, not just the common one. Each card
        routes to the Overlord or Champion deck (or the Overlord scheme deck) by its
        own type, so the two decks aren't guaranteed to end up the same size, and
        nothing here respects the step-4 copy cap — these can freely push a card (or a
        scheme already among the 5 from step 5) past it. */
function generateSealedDecks(setName){
  const bySet = (c) => (c._setNames && c._setNames.length) ? c._setNames.includes(setName) : c._setName===setName;
  const overlordSlot = freshDeckSlot();
  const championSlot = freshDeckSlot();

  // 1. Leaders
  const overlordLeader = weightedRandomPick(state.cards.filter(c=>c.type===leaderTypeName('overlord') && bySet(c)));
  if(overlordLeader) overlordSlot.leaderId = overlordLeader.id;
  const championLeader = weightedRandomPick(state.cards.filter(c=>c.type===leaderTypeName('champion') && bySet(c)));
  if(championLeader) championSlot.leaderId = championLeader.id;

  // 2. Domination/Quest, excluding the matching leader's own aspect
  let dominationPool = state.cards.filter(c=>c.type===bonusCardTypeName('overlord') && bySet(c));
  if(overlordLeader) dominationPool = dominationPool.filter(c=>c.aspect!==overlordLeader.aspect);
  const domination = weightedRandomPick(dominationPool);
  if(domination){ overlordSlot.bonusCardId = domination.id; overlordSlot.bonusAspect = domination.aspect||''; }

  let questPool = state.cards.filter(c=>c.type===bonusCardTypeName('champion') && bySet(c));
  if(championLeader) questPool = questPool.filter(c=>c.aspect!==championLeader.aspect);
  const quest = weightedRandomPick(questPool);
  if(quest){ championSlot.bonusCardId = quest.id; championSlot.bonusAspect = quest.aspect||''; }

  // 3. Stronghold/Resistance — see extraCardPool's own comment on the Z-Custom fallback
  const stronghold = weightedRandomPick(extraCardPool('overlord').filter(c=>bySet(c) || c.type==='Z - Custom'));
  if(stronghold) overlordSlot.extraCardId = stronghold.id;
  const resistance = weightedRandomPick(extraCardPool('champion').filter(c=>bySet(c) || c.type==='Z - Custom'));
  if(resistance) championSlot.extraCardId = resistance.id;

  const overlordAspectLegal = (pool) => overlordLeader ? pool.filter(c=>isAspectLegalFor(c, overlordLeader, overlordSlot.bonusAspect)) : [];
  const championAspectLegal = (pool) => championLeader ? pool.filter(c=>isAspectLegalFor(c, championLeader, championSlot.bonusAspect)) : [];

  // 4. 30 cards per side: the guaranteed lieutenant/ally pair (costing 9 or 10
  // combined) first, then 28 more capped at 2 copies of any one card BY THE END OF
  // THIS STEP (counting the pair, which weightedRandomPickCapped sees via slot.deckCards
  // since pickPairWithCostSum already added it) — the cap stops applying once this step
  // finishes; steps 6-9 can push past it freely.
  const lieutenantPoolLegal = overlordAspectLegal(state.cards.filter(c=>c.type==='O - Lieutenant' && bySet(c)));
  pickPairWithCostSum(lieutenantPoolLegal, [9,10]).forEach(c=> sealedIncrementDeckCard(overlordSlot, c.id));
  const allyPoolLegal = championAspectLegal(state.cards.filter(c=>c.type==='C - Ally' && bySet(c)));
  pickPairWithCostSum(allyPoolLegal, [9,10]).forEach(c=> sealedIncrementDeckCard(championSlot, c.id));

  const overlordMainPoolLegal = overlordAspectLegal(state.cards.filter(c=>isMainDeckEligibleType(c,'overlord') && bySet(c)));
  const championMainPoolLegal = championAspectLegal(state.cards.filter(c=>isMainDeckEligibleType(c,'champion') && bySet(c)));
  weightedRandomPickCapped(overlordMainPoolLegal, 28, overlordSlot, 2);
  weightedRandomPickCapped(championMainPoolLegal, 28, championSlot, 2);

  // 5. 5 DISTINCT Overlord schemes, aspect-legal
  const schemePoolLegal = overlordAspectLegal(state.cards.filter(c=>c.type==='O - Scheme' && bySet(c)));
  weightedRandomPickMany(schemePoolLegal, 5, true).forEach(c=> overlordSlot.schemeIds.push(c.id));

  // 6-9. Shared pool for the remaining 12+6+2+4 = 24 cards: every O-/C- main-deck card
  // AND every O-Scheme card in the set, aspect ignored, routed to whichever deck (or
  // the Overlord scheme deck) its own type belongs in. sealedRouteCard already sends
  // 'O - Scheme' to schemeIds and everything else to deckCards, so routeBonusCard only
  // has to pick which SLOT (Overlord vs Champion) — schemes are always Overlord-side.
  const bonusPool = state.cards.filter(c=> bySet(c) &&
    (isMainDeckEligibleType(c,'overlord') || isMainDeckEligibleType(c,'champion') || c.type==='O - Scheme'));
  const routeBonusCard = (c) => sealedRouteCard(c.type.startsWith('O - ') ? overlordSlot : championSlot, c);
  const tierPool = (tiers) => bonusPool.filter(c=>tiers.includes(rarityTier(c)));
  weightedRandomPickMany(tierPool(['common']), 12).forEach(routeBonusCard);        // 6
  weightedRandomPickMany(tierPool(['uncommon']), 6).forEach(routeBonusCard);       // 7
  weightedRandomPickMany(tierPool(['rare','legendary']), 2).forEach(routeBonusCard); // 8, rarity-weighted between the two tiers
  weightedRandomPickMany(bonusPool, 4).forEach(routeBonusCard);                    // 9, any rarity, weighted

  state.decks.overlord = overlordSlot;
  state.decks.champion = championSlot;
  renderAll();
  toast(`Sealed decks generated from "${setName}": Overlord ${deckCountOf(overlordSlot)} card(s), Champion ${deckCountOf(championSlot)} card(s), ${overlordSlot.schemeIds.length} scheme(s).`);
}

// ---- Sealed button + set picker (moved here from the events section; they only exist for this feature) ----
document.getElementById('btnSealedDecks').addEventListener('click', ()=>{
  if(!confirm('Generate sealed Overlord AND Champion decks (plus the scheme deck) from one shared pool? This replaces BOTH your current Overlord and Champion decks — unsaved changes will be lost.')) return;
  openSealedSetPicker(generateSealedDecks);
});
// generatorFn is whichever set-picker consumer wants to run once a set is chosen —
// only generateSealedDecks today, but left generic rather than inlined in case a
// second sealed-generation entry point returns later.
function openSealedSetPicker(generatorFn){
  const listEl = document.getElementById('sealedSetList');
  listEl.innerHTML = allSetNames().map(n=>`<div class="row-item" data-set="${escapeHtml(n)}">${escapeHtml(n)}</div>`).join('');
  listEl.querySelectorAll('[data-set]').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.getElementById('sealedSetModal').classList.add('hidden');
      generatorFn(el.dataset.set);
      openHelpModal('Sealed Deck Construction');
    });
  });
  document.getElementById('sealedSetModal').classList.remove('hidden');
}
