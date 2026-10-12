/* =========================================================================
   DYNAMIC SCHEMA — filter/detail fields are derived from whatever columns the
   sheet actually has, so adding/removing a (non-structural) column just works.
   ========================================================================= */
function prettifyLabel(key){
  if(LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  return key.split(/[-_]+/).filter(Boolean).map(w=> w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
}
function isRawNameKey(key){ return key.replace(/,+$/,'').trim().toLowerCase()==='raw_name'; }

function computeFieldDefs(){
  const defs = [];
  state.headers.forEach(key=>{
    if(!key || NEVER_FIELDS.has(key) || isRawNameKey(key)) return;
    let nonEmpty=0, numeric=0, slashy=0;
    state.cards.forEach(c=>{
      const v = c[key];
      if(v===undefined||v===null||v==='') return;
      nonEmpty++;
      if(!isNaN(Number(v))) numeric++;
      // Echo mode stays exactly as it always was — slash-separated only. Generic mode
      // additionally treats a comma as a separator, per the user's own convention for
      // third-party sheets (matches how the field gets SPLIT below in getFieldValues).
      if(typeof v==='string' && (v.includes('/') || (!state.isEchoMode && v.includes(',')))) slashy++;
    });
    if(nonEmpty===0) return;
    let kind;
    if(numeric===nonEmpty) kind='range';
    else if(slashy/nonEmpty > 0.2) kind='multi-split';
    else kind='multi';
    defs.push({key, label:prettifyLabel(key), kind});
  });
  const priority = ['type','aspect','loyalty'];
  defs.sort((a,b)=>{
    const pa=priority.indexOf(a.key), pb=priority.indexOf(b.key);
    if(pa===-1 && pb===-1) return 0;
    return (pa===-1?99:pa)-(pb===-1?99:pb);
  });
  state.fieldDefs = defs;
}

function getFieldValues(c, fieldDef){
  const raw = c[fieldDef.key];
  if(raw===undefined||raw===null||raw==='') return [];
  if(fieldDef.kind==='multi-split') return String(raw).split(state.isEchoMode ? '/' : /[/,]/).map(s=>s.trim()).filter(Boolean);
  const v = String(raw).trim();
  return v ? [v] : [];
}

function isStatPresent(card, key){
  const v = card[key];
  if(v===''||v===null||v===undefined) return false;
  if(ZERO_AS_ABSENT.has(key) && Number(v)===0) return false;
  return true;
}

/* =========================================================================
   DECK LEGALITY
   ========================================================================= */
function getLeader(){ return curDeck().leaderId ? state.byId.get(curDeck().leaderId) : null; }
function getBonusCard(){ return curDeck().bonusCardId ? state.byId.get(curDeck().bonusCardId) : null; }
function getExtraCard(){ return curDeck().extraCardId ? state.byId.get(curDeck().extraCardId) : null; }

// True if this card has been edited (per its last-updated stamp) since this deck was
// exported or imported — the baseline for the yellow "changed since" warning.
function cardChangedSinceExport(card){
  const baseline = curDeck().sourceExportedAt;
  if(!baseline || !card) return false;
  const lu = card['last-updated'];
  if(!lu) return false;
  const d = new Date(lu);
  return !isNaN(d) && d.getTime() > new Date(baseline).getTime();
}

// A card referenced by a deck (leader, bonus, extra, deck list, or schemes) can go
// missing from the live feed entirely — deleted via applyPendingDeletions(). Rather
// than showing a bare UUID, this looks up its last-known identity from CardHistory
// (deletions are archived there before removal), with a small cache since the same
// missing id is typically referenced from several places in a render pass.
const removedCardCache = new Map(); // id -> snapshot row | 'loading' | 'not-found'
function getRemovedCardInfo(id){
  if(removedCardCache.has(id)) return removedCardCache.get(id);
  removedCardCache.set(id, 'loading');
  fetchCardHistory(id).then(rows=>{
    if(!rows.length){ removedCardCache.set(id, 'not-found'); renderAll(); return; }
    rows.sort((a,b)=> new Date(b['archived-at']) - new Date(a['archived-at']));
    removedCardCache.set(id, rows[0]); // most recent snapshot = last known state
    renderAll();
  }).catch(()=>{ removedCardCache.set(id, 'not-found'); renderAll(); });
  return 'loading';
}
// Type membership for whichever pool is currently active — this is a hard rule with
// no leader dependency at all (a Champion card can never go in an Overlord deck,
// leader chosen or not).
function isTypeEligible(card){
  if(!card) return false;
  // Generic mode has no leaders/schemes/dominations/strongholds to exclude and no
  // Overlord-vs-Champion pool split — every card is eligible for the single deck.
  if(!state.isEchoMode) return true;
  if(activeIsSchemeMode()) return card.type==='O - Scheme';
  const prefix = prefixFor(state.deckType);
  if(!card.type.startsWith(prefix)) return false;
  if(card.type===leaderTypeName(state.deckType)) return false;
  if(card.type===prefix+'Scheme') return false;
  if(card.type===bonusCardTypeName(state.deckType)) return false;
  if(card.type===extraCardTypeName(state.deckType)) return false;
  if(card.type==='Z - Custom') return false; // the placeholder is only ever picked via the dedicated slot, never the general pool
  return true;
}

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
function isLegalForCurrentPool(card){
  if(!isTypeEligible(card)) return false;
  if(!getLeader()) return true;
  return isAspectLegal(card);
}

function deckTotalCount(){ let n=0; for(const v of curDeck().deckCards.values()) n+=v; return n; }

/* =========================================================================
   POOL — visibility-based (no leader = unrestricted type-eligible pool; leader chosen =
   pool narrows to legal aspects immediately, rather than graying out illegal cards).
   ========================================================================= */
// Aspect-illegal cards stay in the pool (grayed out, sorted last, still fully
// examinable and addable) rather than being hidden — only TYPE eligibility is a hard
// filter here. isLegalForCurrentPool (type + aspect) still drives what counts as
// "illegal" for graying/sorting/the red highlight/the Remove-illegal-cards button.
function poolForCurrentMode(){
  return state.cards.filter(isTypeEligible);
}

