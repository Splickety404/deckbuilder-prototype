/* =========================================================================
   SEALED DECK GENERATOR — builds one Saga deck (the prebuilt "starter" deck) for
   whichever side is being viewed. Rules follow the EoO Set 1 Saga Deck Rules doc,
   with its default settings hard-coded as the constants below.
   ========================================================================= */
const SAGA = {
  rarityWeights: { common:65, uncommon:30, rare:5 }, // relative weights for the rarity roll
  legendaryUpgrade: 0.10,                            // chance a Rare roll becomes Legendary
  guaranteedFirstRare: true,                         // first main-deck draw always rolls Rare
  loyaltyModifier: { loyal:5/3, standard:1, neutral:5/9 },
  maxCopies: 2,
  mainDeckSize: 28,
  schemeCount: 5,
};

function rarityTier(card){
  const r = String(card.rarity||'').trim().toLowerCase();
  return (r==='legendary'||r==='rare'||r==='uncommon'||r==='common') ? r : 'common'; // unspecified rarity counts as common
}
function randomOf(list){ return list.length ? list[Math.floor(Math.random()*list.length)] : null; }

// Rolls a rarity for a pool: Common/Uncommon/Rare by weight, then Rare may upgrade to
// Legendary. A rarity with no cards left is skipped (the roll is redone among the rest),
// and if Rare is rolled but only Legendaries remain (or the reverse) the other is used.
function rollRarity(pool, forceRare){
  const has = {};
  pool.forEach(c=>{ has[rarityTier(c)] = true; });
  const baseAvail = { common:!!has.common, uncommon:!!has.uncommon, rare:!!(has.rare||has.legendary) };
  let tiers = Object.keys(SAGA.rarityWeights).filter(t=>baseAvail[t]);
  if(forceRare && baseAvail.rare) tiers = ['rare'];
  if(!tiers.length) return null;
  const total = tiers.reduce((s,t)=>s+SAGA.rarityWeights[t], 0);
  let r = Math.random()*total, tier = tiers[tiers.length-1];
  for(const t of tiers){ r -= SAGA.rarityWeights[t]; if(r<=0){ tier=t; break; } }
  if(tier!=='rare') return tier;
  if(!has.legendary) return 'rare';
  if(!has.rare) return 'legendary';
  return Math.random()<SAGA.legendaryUpgrade ? 'legendary' : 'rare';
}
function loyaltyClass(card){
  if(isNeutral(card)) return 'neutral';
  return card.loyalty==='Loyal' ? 'loyal' : 'standard';
}
// Draws one card: rarity roll first, then a pick within that rarity weighted by loyalty
// modifier (every type weight is 1). `useModifiers` is off for leaders.
function sagaDraw(pool, opts){
  opts = opts||{};
  const tier = rollRarity(pool, opts.forceRare);
  if(!tier) return null;
  const inTier = pool.filter(c=>rarityTier(c)===tier);
  if(!opts.useModifiers) return randomOf(inTier);
  const weightOf = (c)=>SAGA.loyaltyModifier[loyaltyClass(c)];
  let r = Math.random()*inTier.reduce((s,c)=>s+weightOf(c),0);
  for(const c of inTier){ r -= weightOf(c); if(r<=0) return c; }
  return inTier[inTier.length-1];
}

// Mirrors the main-deck branch of isTypeEligible, but independent of the scheme-mode toggle.
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
// Do any of a card's text fields contain this whole word / phrase? (Subtype column names
// aren't known here, so this checks every field.)
function cardMentions(card, phrase){
  const re = new RegExp('\\b'+phrase+'\\b','i');
  return Object.values(card).some(v=>typeof v==='string' && re.test(v));
}
// Saga aspect rules: the leader's aspect, the Domination/Quest's aspect, or Neutral — but
// a Loyal card only ever matches the LEADER's aspect. Hob can also take any Shade ally.
function isSagaLegal(card, leader, bonusAspect){
  if(isNeutral(card)) return true;
  if(card.loyalty==='Loyal'){
    if(card.aspect===leader.aspect) return true;
  } else if(card.aspect===leader.aspect || (bonusAspect && card.aspect===bonusAspect)) return true;
  return leader.name==='Hob' && card.type==='C - Ally' && cardMentions(card,'Shade');
}

function deckCountOf(slot){ let n=0; for(const v of slot.deckCards.values()) n+=v; return n; }

// Draws n cards one at a time into `counts` (id -> copies), never exceeding the copy limit.
function sagaDrawMany(pool, n, counts, leader, opts){
  const out = [];
  for(let i=0;i<n;i++){
    const eligible = pool.filter(c=>{
      const limit = SAGA.maxCopies + ((leader.name==='Commander Koross' && cardMentions(c,'Undying Legion')) ? 1 : 0);
      return (counts.get(c.id)||0) < limit;
    });
    const c = sagaDraw(eligible, {useModifiers:true, forceRare: opts && opts.firstIsRare && i===0});
    if(!c) break;
    counts.set(c.id, (counts.get(c.id)||0)+1);
    out.push(c);
  }
  return out;
}

function generateSagaDeck(setName, deckType){
  const bySet = (c) => (c._setNames && c._setNames.length) ? c._setNames.includes(setName) : c._setName===setName;
  const slot = freshDeckSlot();
  const pick = (list)=>list.filter(bySet);

  // Leader: same rarity pull rates as the deck, no loyalty modifiers
  const leader = sagaDraw(pick(state.cards.filter(c=>c.type===leaderTypeName(deckType))));
  if(!leader){ toast('No leaders found in that set.'); return; }
  slot.leaderId = leader.id;

  // Domination / Quest: 1 in 3, whatever the leader's aspect
  const bonus = randomOf(pick(state.cards.filter(c=>c.type===bonusCardTypeName(deckType))));
  if(bonus){ slot.bonusCardId = bonus.id; slot.bonusAspect = bonus.aspect||''; }

  // Stronghold / Resistance — see extraCardPool's comment on the Z-Custom placeholder
  const extra = randomOf(extraCardPool(deckType).filter(c=>bySet(c) || c.type==='Z - Custom'));
  if(extra) slot.extraCardId = extra.id;

  const legal = (list)=>pick(list).filter(c=>isSagaLegal(c, leader, slot.bonusAspect));

  // Overlord only: 5 schemes first
  if(deckType==='overlord'){
    const counts = new Map();
    sagaDrawMany(legal(state.cards.filter(c=>c.type==='O - Scheme')), SAGA.schemeCount, counts, leader)
      .forEach(c=>slot.schemeIds.push(c.id));
  }

  // 28 main-deck cards; the first is a guaranteed Rare
  const mainPool = legal(state.cards.filter(c=>isMainDeckEligibleType(c, deckType)));
  sagaDrawMany(mainPool, SAGA.mainDeckSize, slot.deckCards, leader, {firstIsRare:SAGA.guaranteedFirstRare})
    .forEach(c=>{ if(!slot.deckOrder.includes(c.id)) slot.deckOrder.push(c.id); });

  state.decks[deckType] = slot;
  renderAll();
  const total = 1 + (bonus?1:0) + deckCountOf(slot) + slot.schemeIds.length; // leader + Domination/Quest + cards
  const expected = deckType==='overlord' ? 35 : 30;
  toast(`Saga deck generated from "${setName}": ${total} cards${total<expected?` (short of ${expected} — the allowed pool ran out)`:''}.`);
}

// ---- Button + set picker ----
document.getElementById('btnSealedDeck').addEventListener('click', ()=>{
  const deckType = state.deckType;
  const side = deckType==='overlord' ? 'Overlord' : 'Champion';
  if(!confirm(`Generate a Saga deck for the ${side} side? This replaces your current ${side} deck — unsaved changes will be lost.`)) return;
  const sets = allSetNames();
  if(sets.length===1){ generateSagaDeck(sets[0], deckType); return; }
  openSealedSetPicker((setName)=>generateSagaDeck(setName, deckType));
});
function openSealedSetPicker(generatorFn){
  const listEl = document.getElementById('sealedSetList');
  listEl.innerHTML = allSetNames().map(n=>`<div class="row-item" data-set="${escapeHtml(n)}">${escapeHtml(n)}</div>`).join('');
  listEl.querySelectorAll('[data-set]').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.getElementById('sealedSetModal').classList.add('hidden');
      generatorFn(el.dataset.set);
    });
  });
  document.getElementById('sealedSetModal').classList.remove('hidden');
}
