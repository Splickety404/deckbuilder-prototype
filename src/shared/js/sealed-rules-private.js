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
  guaranteedFirstRare: true,                         // first main-deck draw always rolls Rare
  loyaltyModifier: { loyal:5/3, standard:1, neutral:5/9 },
  maxCopies: 2,
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

// Draws n cards one at a time into `counts` (id -> copies), never exceeding the copy limit.
function sagaDrawMany(pool, n, counts, leader, opts){
  const out = [];
  for(let i=0;i<n;i++){
    const eligible = pool.filter(c=>{
      if(opts && opts.maxCopies) return (counts.get(c.id)||0) < opts.maxCopies; // e.g. schemes: never two of the same
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

  // 30 main-deck cards; the first is a guaranteed Rare
  const mainPool = legal(cards.filter(c=>isMainDeckEligibleType(c, deckType)));
  sagaDrawMany(mainPool, SAGA.mainDeckSize, deck.deckCards, leader, {firstIsRare:SAGA.guaranteedFirstRare})
    .forEach(c=>{ if(!deck.deckOrder.includes(c.id)) deck.deckOrder.push(c.id); });

  deck.expectedSize = 2 + SAGA.mainDeckSize + (deckType==='overlord' ? SAGA.schemeCount : 0);
  return { deck, leader, hasBonus: !!bonus };
}
