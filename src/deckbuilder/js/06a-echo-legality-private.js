/* =========================================================================
   ECHO — CARD TYPES, LEADERS AND LEGALITY (private). Which card types belong to
   the Overlord and Champion decks, the leader / Domination / Stronghold cards a
   deck points at, and the aspect rules that decide whether a card is legal for a
   leader. Hooked in through EchoGame.isTypeEligible / EchoGame.isLegal (see the
   game definition in 01b/01c); moved here unchanged. Free-form games have no
   such rules: every card is eligible and legal.
   ========================================================================= */
function getLeader(){ return curDeck().leaderId ? state.byId.get(curDeck().leaderId) : null; }
function getBonusCard(){ return curDeck().bonusCardId ? state.byId.get(curDeck().bonusCardId) : null; }
function getExtraCard(){ return curDeck().extraCardId ? state.byId.get(curDeck().extraCardId) : null; }


/* Neutral cards are identified by their aspect value itself (e.g. "OLNeutral"/"CHNeutral"
   in the live data) rather than by process-of-elimination against leader cards. */
function isNeutral(card){ return /neutral/i.test(card.aspect||''); }

let _realAspects = {overlord:new Set(), champion:new Set()};
function computeAndCacheAspects(){
  _realAspects.overlord = new Set(state.cards.filter(c=>c.type.startsWith('O - ') && c.aspect && !isNeutral(c)).map(c=>c.aspect));
  _realAspects.champion = new Set(state.cards.filter(c=>c.type.startsWith('C - ') && c.aspect && !isNeutral(c)).map(c=>c.aspect));
}
function leaderTypeName(deckType){ return deckType==='overlord' ? 'O - Overlord' : 'C - Champion'; }
function prefixFor(deckType){ return deckType==='overlord' ? 'O - ' : 'C - '; }
function bonusCardTypeName(deckType){ return deckType==='overlord' ? 'O - Domination' : 'C - Quest'; }
function extraCardTypeName(deckType){ return deckType==='overlord' ? 'O - Stronghold' : 'C - Resistance'; }
const EXTRA_CARD_PLACEHOLDER_NAME = { overlord:'Stronghold', champion:'Resistance' };
const HORIZONTAL_TYPES = new Set(['O - Domination','C - Quest','O - Stronghold','C - Resistance']);

// Real O - Stronghold / C - Resistance cards, once any exist, are always preferred over
// the Z - Custom placeholder standing in for them today — checked fresh each load, no
// manual switch-over needed.
function extraCardPool(deckType){
  const real = state.cards.filter(c=>c.type===extraCardTypeName(deckType));
  if(real.length) return real;
  const placeholderName = EXTRA_CARD_PLACEHOLDER_NAME[deckType];
  return state.cards.filter(c=>c.type==='Z - Custom' && c.name===placeholderName);
}

// Type membership for whichever pool is currently active — this is a hard rule with
// no leader dependency at all (a Champion card can never go in an Overlord deck,
// leader chosen or not).
EchoGame.isTypeEligible = function(card){
  if(activeIsSchemeMode()) return card.type==='O - Scheme';
  const prefix = prefixFor(state.deckType);
  if(!card.type.startsWith(prefix)) return false;
  if(card.type===leaderTypeName(state.deckType)) return false;
  if(card.type===prefix+'Scheme') return false;
  if(card.type===bonusCardTypeName(state.deckType)) return false;
  if(card.type===extraCardTypeName(state.deckType)) return false;
  if(card.type==='Z - Custom') return false; // the placeholder is only ever picked via the dedicated slot, never the general pool
  return true;
};

// Aspect/loyalty eligibility — identical rule for the 50-card deck and the 5-scheme
// deck (confirmed): neutral always legal; loyal cards only match the leader's own
// aspect; everything else needs leader's aspect OR the chosen Domination/Quest Aspect.
// Meaningless without a leader chosen yet, so callers should only consult this once
// getLeader() is non-null.
function isAspectLegal(card){
  const leader = getLeader();
  if(!leader) return false;
  if(isNeutral(card)) return true;
  if(card.loyalty==='Loyal') return card.aspect===leader.aspect;
  return card.aspect===leader.aspect || (curDeck().bonusAspect && card.aspect===curDeck().bonusAspect);
}

// Full legality for whichever pool is active. Deliberately permissive before a leader
// is chosen — type membership is the only hard rule at that point, since there's no
// aspect to check against yet — then tightens to also require aspect legality once a
// leader is picked. This single function backs both what's addable and what gets
// flagged as illegal in an existing deck.
EchoGame.isLegal = function(card){
  if(!isTypeEligible(card)) return false;
  if(!getLeader()) return true;
  return isAspectLegal(card);
};
