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
      if(typeof v==='string' && (v.includes('/') || (state.game.commaSplits && v.includes(',')))) slashy++;
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
  if(fieldDef.kind==='multi-split') return String(raw).split(state.game.multiValueSplit).map(s=>s.trim()).filter(Boolean);
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

// A card referenced by a deck (leader, bonus, extra, deck list, or side lists) can go
// missing from the live feed entirely — deleted via applyPendingDeletions(). Rather
// than showing a bare UUID, this looks up its last-known identity from CardHistory
// (deletions are archived there before removal), with a small cache since the same
// missing id is typically referenced from several places in a render pass.
const removedCardCache = new Map(); // id -> snapshot row | 'loading' | 'not-found'
function getRemovedCardInfo(id){
  if(removedCardCache.has(id)) return removedCardCache.get(id);
  removedCardCache.set(id, 'loading');
  cardSource.cardHistory(id).then(rows=>{
    if(!rows.length){ removedCardCache.set(id, 'not-found'); renderAll(); return; }
    rows.sort((a,b)=> new Date(b['archived-at']) - new Date(a['archived-at']));
    removedCardCache.set(id, rows[0]); // most recent snapshot = last known state
    renderAll();
  }).catch(()=>{ removedCardCache.set(id, 'not-found'); renderAll(); });
  return 'loading';
}
// Which cards may go in the deck being edited — a hard rule, decided by the game. A free-form
// game allows every card; a structured game filters by card type (see the game definition).
function isTypeEligible(card){
  if(!card) return false;
  return state.game.isTypeEligible(card);
}

// Full legality for the deck being edited. This single function backs both what's addable and
// what gets flagged as illegal in an existing deck.
function isLegalForCurrentPool(card){ return state.game.isLegal(card); }

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
  return state.cards.filter(c=> isTypeEligible(c) && state.game.inActiveView(c));
}

