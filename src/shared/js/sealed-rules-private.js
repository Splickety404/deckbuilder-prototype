/* =========================================================================
   SAGA (SEALED) DECK RULES — the ONE place the "Get Sealed Deck" rules live, used
   by both the deckbuilder and the game room (the build adds src/shared/js to every
   app). Change a rule here and both pick it up. Pure rules only: nothing here
   touches either app's own state — callers pass in the cards to draw from.
   Rules follow the EoO Set 1 Saga Deck Rules doc, with its default settings
   hard-coded as the constants below.
   ========================================================================= */
/* Neutral cards are identified by their aspect value itself (e.g. "OLNeutral"/"CHNeutral"
   in the live data) rather than by process-of-elimination against leader cards. */
function isNeutral(card){ return /neutral/i.test(card.aspect||''); }

function leaderTypeName(deckType){ return deckType==='overlord' ? 'O - Overlord' : 'C - Champion'; }
function prefixFor(deckType){ return deckType==='overlord' ? 'O - ' : 'C - '; }
function bonusCardTypeName(deckType){ return deckType==='overlord' ? 'O - Domination' : 'C - Quest'; }
function extraCardTypeName(deckType){ return deckType==='overlord' ? 'O - Stronghold' : 'C - Resistance'; }
const EXTRA_CARD_PLACEHOLDER_NAME = { overlord:'Stronghold', champion:'Resistance' };

// Real O - Stronghold / C - Resistance cards, once any exist, are always preferred over
// the Z - Custom placeholder standing in for them today — checked fresh each load, no
// manual switch-over needed.
function extraCardPoolFrom(cards, deckType){
  const real = cards.filter(c=>c.type===extraCardTypeName(deckType));
  if(real.length) return real;
  const placeholderName = EXTRA_CARD_PLACEHOLDER_NAME[deckType];
  return cards.filter(c=>c.type==='Z - Custom' && c.name===placeholderName);
}

const SAGA = {
  rarityWeights: { common:65, uncommon:30, rare:5 }, // relative weights for the rarity roll
  legendaryUpgrade: 0.10,                            // chance a Rare roll becomes Legendary
  // The 30 main-deck cards are drawn from fixed rarity slots (see sagaMainDeckSlots):
  // 3 Rare (each may upgrade to Legendary), 6 Uncommon (2 of them may upgrade to Rare),
  // 11 Common, and the rest filled Common/Uncommon by rarityWeights.
  mainDeckPlan: { rare:3, uncommon:6, uncommonUpgradable:2, common:11 },
  upgradeChance: 0.10,                               // chance an upgradable slot moves up one rarity
  loyaltyModifier: { loyal:5/3, standard:1, neutral:5/9 },
  maxCopies: 2,
  // Tribe minimums (main-deck copies, by Traits column): if a deck contains any card of the tribe it
  // must contain at least `min`. See sagaEnforceTribes.
  tribes: [
    { name:'Shade',          trait:'shade',          deckType:'champion', min:2 },
    { name:'Nynock',         trait:'nynock',         deckType:'overlord', min:3 },
    { name:'Undying Legion', trait:'undying legion', deckType:'overlord', min:3 },
  ],
  mainDeckSize: 30,
  schemeCount: 5,
  // A scheme's "quest" value comes from its deckbuilding-requirement; a deck's 5 schemes must total at least 15.
  questValue: { empty:2, default:3, full:4 },
  minSchemeQuest: 15,
};
function schemeQuest(card){
  const v = String(card['deckbuilding-requirement']||'').trim().toLowerCase();
  return SAGA.questValue.hasOwnProperty(v) ? SAGA.questValue[v] : SAGA.questValue.default; // blank counts as Default
}
function schemesQuestTotal(cards){ return cards.reduce((n,c)=>n+schemeQuest(c), 0); }

// Draws the Saga deck's schemes: all different, and together worth at least minSchemeQuest quest.
// Redraws a few times; if that still falls short (a tiny pool), swaps the lowest-quest
// scheme for a higher-quest unused one until it's met or nothing better is left.
function drawSagaSchemes(pool, leader){
  let best = [];
  for(let attempt=0; attempt<200; attempt++){
    const drawn = sagaDrawMany(pool, SAGA.schemeCount, new Map(), leader, {maxCopies:1});
    if(schemesQuestTotal(drawn) > schemesQuestTotal(best)) best = drawn;
    if(schemesQuestTotal(drawn) >= SAGA.minSchemeQuest) return drawn;
  }
  while(schemesQuestTotal(best) < SAGA.minSchemeQuest){
    const lowest = best.reduce((a,b)=> schemeQuest(b)<schemeQuest(a) ? b : a);
    const better = pool.filter(c=>!best.some(b=>b.id===c.id) && schemeQuest(c)>schemeQuest(lowest));
    const swap = randomOf(better);
    if(!swap) break;
    best = best.map(c=> c===lowest ? swap : c);
  }
  return best;
}

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
// Drawing weight inside a rarity. SAGA_CARD_WEIGHTS (saga-weights-private.js, written by
// scripts/calibrate-saga-weights.js) holds a per-card weight tuned so that cards of one rarity show up
// in generated decks at nearly the same rate; a card without an entry falls back to its loyalty modifier.
function sagaCardWeight(c){
  const w = (typeof SAGA_CARD_WEIGHTS!=='undefined') ? SAGA_CARD_WEIGHTS[c.id] : 0;
  return w || SAGA.loyaltyModifier[loyaltyClass(c)];
}
function loyaltyClass(card){
  if(isNeutral(card)) return 'neutral';
  return card.loyalty==='Loyal' ? 'loyal' : 'standard';
}
// Draws one card: rarity roll first, then a pick within that rarity weighted by loyalty
// modifier (every type weight is 1). `useModifiers` is off for leaders.
function sagaDraw(pool, opts){
  opts = opts||{};
  const tier = opts.tier || rollRarity(pool, opts.forceRare);
  if(!tier) return null;
  const inTier = pool.filter(c=>rarityTier(c)===tier);
  if(!inTier.length) return null;
  if(!opts.useModifiers) return randomOf(inTier);
  const weightOf = sagaCardWeight;
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

// The 30 main-deck slots, each {tier, upgradeTo?}: a fixed number of cards of each rarity,
// with some slots that may (upgradeChance) move up one rarity, then "fill" slots that roll
// Common/Uncommon by weight.
function sagaMainDeckSlots(){
  const plan = SAGA.mainDeckPlan, slots = [];
  for(let i=0;i<plan.rare;i++) slots.push({ tier:'rare', upgradeTo:'legendary' });
  for(let i=0;i<plan.uncommon;i++) slots.push(i<plan.uncommonUpgradable ? { tier:'uncommon', upgradeTo:'rare' } : { tier:'uncommon' });
  for(let i=0;i<plan.common;i++) slots.push({ tier:'common' });
  while(slots.length<SAGA.mainDeckSize) slots.push({ fill:true });
  return slots.slice(0, SAGA.mainDeckSize);
}
// Other rarities to try, nearest first, when a slot's own rarity has nothing left to draw.
const SAGA_TIER_FALLBACK = {
  legendary:['rare','uncommon','common'], rare:['legendary','uncommon','common'],
  uncommon:['common','rare','legendary'], common:['uncommon','rare','legendary'],
};
// Draws the card for one slot from `eligible` (cards not yet at their copy limit).
function sagaDrawSlot(eligible, slot){
  let tier = slot.tier;
  if(slot.fill){
    const w = SAGA.rarityWeights, has = {};
    eligible.forEach(c=>{ has[rarityTier(c)] = true; });
    const opts = ['common','uncommon'].filter(t=>has[t]);
    if(opts.length){
      let r = Math.random()*opts.reduce((n,t)=>n+w[t],0);
      tier = opts[opts.length-1];
      for(const t of opts){ r -= w[t]; if(r<=0){ tier=t; break; } }
    } else tier = 'common'; // only Rare/Legendary left — falls through to the fallback order
  } else if(slot.upgradeTo && Math.random()<SAGA.upgradeChance) tier = slot.upgradeTo;
  for(const t of [tier].concat(SAGA_TIER_FALLBACK[tier])){
    const c = sagaDraw(eligible, {useModifiers:true, tier:t});
    if(c) return c;
  }
  return null;
}

function sagaCopyLimit(card, leader){
  return SAGA.maxCopies + ((leader.name==='Commander Koross' && cardMentions(card,'Undying Legion')) ? 1 : 0);
}
function cardHasTrait(card, trait){
  return String(card.traits||'').split(/[,;\/]/).some(t=>t.trim().toLowerCase()===trait);
}
function sagaWeightedPick(list){
  let r = Math.random()*list.reduce((n,c)=>n+sagaCardWeight(c),0);
  for(const c of list){ r -= sagaCardWeight(c); if(r<=0) return c; }
  return list[list.length-1] || null;
}
// Tribe minimums. A deck that holds some cards of a tribe but fewer than its minimum is topped up:
// tribe cards are swapped in for non-tribe cards OF THE SAME RARITY (so the deck's rarity mix never
// changes). If the legal pool can't reach the minimum, the tribe is swapped out entirely instead.
// `out` is the drawn card list (draw order), `counts` the id -> copies map; both are updated.
function sagaEnforceTribes(out, counts, pool, leader, deckType){
  const tribes = SAGA.tribes.filter(t=>t.deckType===deckType);
  const inAnyTribe = (c)=>tribes.some(t=>cardHasTrait(c,t.trait));
  const swap = (i, card)=>{
    counts.set(out[i].id, (counts.get(out[i].id)||0)-1);
    counts.set(card.id, (counts.get(card.id)||0)+1);
    out[i] = card;
  };
  // index of a non-tribe card to give up: same rarity as `tier` if possible, else the nearest other rarity
  const victimFor = (tier)=>{
    for(const t of [tier].concat(SAGA_TIER_FALLBACK[tier])){
      const idx = out.map((c,i)=>i).filter(i=>!inAnyTribe(out[i]) && rarityTier(out[i])===t);
      if(idx.length) return idx[Math.floor(Math.random()*idx.length)];
    }
    return -1;
  };
  tribes.forEach(t=>{
    const members = pool.filter(c=>cardHasTrait(c,t.trait));
    const have = out.filter(c=>cardHasTrait(c,t.trait)).length;
    if(have===0 || have>=t.min) return;
    const open = ()=>members.filter(c=>(counts.get(c.id)||0) < sagaCopyLimit(c, leader));
    const room = open().reduce((n,c)=>n + sagaCopyLimit(c,leader)-(counts.get(c.id)||0), 0);
    if(room >= t.min-have){
      for(let k=have;k<t.min;k++){
        const add = sagaWeightedPick(open());
        const i = add ? victimFor(rarityTier(add)) : -1;
        if(i<0) break;
        swap(i, add);
      }
    } else {
      out.map((c,i)=>i).filter(i=>cardHasTrait(out[i],t.trait)).forEach(i=>{
        const tier = rarityTier(out[i]);
        const eligible = pool.filter(c=>!inAnyTribe(c) && (counts.get(c.id)||0) < sagaCopyLimit(c, leader));
        for(const tt of [tier].concat(SAGA_TIER_FALLBACK[tier])){
          const c = sagaDraw(eligible, {useModifiers:true, tier:tt});
          if(c){ swap(i, c); return; }
        }
      });
    }
  });
}

// Draws cards one at a time into `counts` (id -> copies), never exceeding the copy limit.
// `slots` (optional) is a list of rarity slots; otherwise n plain rarity-rolled draws.
function sagaDrawMany(pool, n, counts, leader, opts){
  const out = [], slots = opts && opts.slots;
  for(let i=0;i<(slots ? slots.length : n);i++){
    const eligible = pool.filter(c=>{
      if(opts && opts.maxCopies) return (counts.get(c.id)||0) < opts.maxCopies; // e.g. schemes: never two of the same
      return (counts.get(c.id)||0) < sagaCopyLimit(c, leader);
    });
    const c = slots ? sagaDrawSlot(eligible, slots[i]) : sagaDraw(eligible, {useModifiers:true});
    if(!c) break;
    counts.set(c.id, (counts.get(c.id)||0)+1);
    out.push(c);
  }
  return out;
}

// Builds one Saga deck for `deckType` from `cards` (every card the caller can see;
// `inSet(card)` says which of them belong to the chosen set). Returns the deck as
// plain data — {leaderId, bonusCardId, bonusAspect, extraCardId, schemeIds,
// deckCards (Map id -> copies), deckOrder} — or {error} when the set has no leaders.
function buildSagaDeck(cards, deckType, inSet){
  const deck = { leaderId:null, bonusCardId:null, bonusAspect:'', extraCardId:null, schemeIds:[], deckCards:new Map(), deckOrder:[] };
  const pick = (list)=>list.filter(inSet);

  // Leader: same rarity pull rates as the deck, no loyalty modifiers
  const leader = sagaDraw(pick(cards.filter(c=>c.type===leaderTypeName(deckType))));
  if(!leader) return { error:'No leaders found in that set.' };
  deck.leaderId = leader.id;

  // Domination / Quest: 1 in 3, but never one that shares the leader's aspect
  const bonus = randomOf(pick(cards.filter(c=>c.type===bonusCardTypeName(deckType) && c.aspect!==leader.aspect)));
  if(bonus){ deck.bonusCardId = bonus.id; deck.bonusAspect = bonus.aspect||''; }

  // Stronghold / Resistance — see extraCardPoolFrom's comment on the Z-Custom placeholder
  const extra = randomOf(extraCardPoolFrom(cards, deckType).filter(c=>inSet(c) || c.type==='Z - Custom'));
  if(extra) deck.extraCardId = extra.id;

  const legal = (list)=>pick(list).filter(c=>isSagaLegal(c, leader, deck.bonusAspect));

  // Overlord only: 5 schemes first
  if(deckType==='overlord'){
    drawSagaSchemes(legal(cards.filter(c=>c.type==='O - Scheme')), leader) // 5 different schemes, 15+ quest in total
      .forEach(c=>deck.schemeIds.push(c.id));
  }

  // 30 main-deck cards, drawn from fixed rarity slots (see sagaMainDeckSlots)
  const mainPool = legal(cards.filter(c=>isMainDeckEligibleType(c, deckType)));
  const drawn = sagaDrawMany(mainPool, SAGA.mainDeckSize, deck.deckCards, leader, {slots:sagaMainDeckSlots()});
  sagaEnforceTribes(drawn, deck.deckCards, mainPool, leader, deckType); // tribe minimums (Shade / Nynock / Undying Legion)
  deck.deckCards.forEach((n,id)=>{ if(n<=0) deck.deckCards.delete(id); }); // cards swapped out entirely
  drawn.forEach(c=>{ if(!deck.deckOrder.includes(c.id)) deck.deckOrder.push(c.id); });

  deck.expectedSize = 2 + SAGA.mainDeckSize + (deckType==='overlord' ? SAGA.schemeCount : 0);
  return { deck, leader, hasBonus: !!bonus };
}
