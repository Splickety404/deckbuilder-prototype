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



let _realAspects = {overlord:new Set(), champion:new Set()};
function computeAndCacheAspects(){
  _realAspects.overlord = new Set(state.cards.filter(c=>c.type.startsWith('O - ') && c.aspect && !isNeutral(c)).map(c=>c.aspect));
  _realAspects.champion = new Set(state.cards.filter(c=>c.type.startsWith('C - ') && c.aspect && !isNeutral(c)).map(c=>c.aspect));
}
const HORIZONTAL_TYPES = new Set(['O - Domination','C - Quest','O - Stronghold','C - Resistance']);

// Real O - Stronghold / C - Resistance cards, once any exist, are always preferred over
// the Z - Custom placeholder standing in for them today — checked fresh each load, no
// manual switch-over needed.
function extraCardPool(deckType){ return extraCardPoolFrom(state.cards, deckType); }

// Which section of the deck being edited a card belongs in, by its type — or null if it can't go
// in this deck at all (a Champion card can never go in an Overlord deck, leader chosen or not).
function echoHomeSection(card){
  const deckType = state.deckType;
  if(card.type==='Z - Custom') return card.name===EXTRA_CARD_PLACEHOLDER_NAME[deckType] ? 'extra' : null; // the Stronghold/Resistance stand-in
  const prefix = prefixFor(deckType);
  if(!card.type.startsWith(prefix)) return null;
  if(card.type===leaderTypeName(deckType)) return 'leader';
  if(card.type===bonusCardTypeName(deckType)) return 'bonus';
  if(card.type===extraCardTypeName(deckType)) return 'extra';
  if(card.type===prefix+'Scheme') return deckType==='overlord' ? 'schemes' : null;
  return 'deck';
}

// Type membership is a hard rule: any card with a section in this deck may be added (it lands in
// its own section). The card pool shows only the open section's cards (inActiveView).
EchoGame.isTypeEligible = function(card){ return echoHomeSection(card)!==null; };
EchoGame.inActiveView = function(card){
  const sec = echoHomeSection(card);
  // Same allowance the sealed-deck generator uses: the stand-in only shows while no real Stronghold/Resistance exists.
  if(sec==='extra' && card.type==='Z - Custom') return echoActiveSection()==='extra' && extraCardPool(state.deckType).includes(card);
  return sec===echoActiveSection();
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
  const sec = echoHomeSection(card);
  if(!sec) return false;
  if(sec!=='deck' && sec!=='schemes') return true; // the leader / Domination / Stronghold have no aspect rule
  if(!getLeader()) return true;
  return isAspectLegal(card);
};
