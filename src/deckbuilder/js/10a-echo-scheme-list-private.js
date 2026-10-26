/* =========================================================================
   ECHO — SCHEME DECK AND SETUP-CARD LISTS (private). Besides the main deck, an
   Echo deck holds a scheme list (schemeIds, duplicates allowed) and one card each
   for the leader / Domination-Quest / Stronghold-Resistance. The shared panel asks
   which list a card belongs to (listOf / activeSideList in the game definition)
   and has that list count / reorder / add / remove it.
   ========================================================================= */
const SchemeList = {
  render(zone){
    if(!curDeck().schemeIds.length){
      zone.innerHTML = `<div id="deck-empty-hint">Drag schemes here, or use the + button on a card. Choose exactly 5.</div>`;
    }
    const schemeCounts = {}, schemeOrder = [];
    curDeck().schemeIds.forEach(id=>{
      if(!(id in schemeCounts)){ schemeCounts[id]=0; schemeOrder.push(id); }
      schemeCounts[id]++;
    });
    schemeOrder.forEach(id=>{
      zone.appendChild(buildDeckRow(id, state.byId.get(id), {qty:schemeCounts[id], showStepper:true}));
    });
  },
  has(id){ return curDeck().schemeIds.includes(id); },
  count(id){ return curDeck().schemeIds.filter(x=>x===id).length; },
  order(){ return curDeck().schemeIds; },
  setOrder(arr){ curDeck().schemeIds = arr; },
  removeOne(id){ removeScheme(id); },
  removeAll(id){ curDeck().schemeIds = curDeck().schemeIds.filter(x=>x!==id); },
  add(ids){
    let added=0, skipped=0;
    ids.forEach(id=>{
      const c = state.byId.get(id);
      if(!c || !isTypeEligible(c)) { skipped++; return; } // aspect-illegal cards ARE addable now — only wrong type is a hard block
      curDeck().schemeIds.push(id); added++; // duplicates now allowed freely, same as main-deck cards — the rules checklist flags >1 copy, it never blocks it
    });
    toast(`Added ${added} scheme${added!==1?'s':''}${skipped?`, skipped ${skipped}`:''}.`);
  },
};

// A one-card setup slot (leaderId / bonusCardId / extraCardId). The slot holds the chosen card; any
// further card of that type (added by hand or pulled from a booster) is kept in the deck list as
// an extra, so the section shows "2 / 1" in red until one is removed. Removing the chosen card
// moves the first extra up into the slot.
function echoSlotList(field, sec){
  const setSlot = (id)=>{
    curDeck()[field] = id;
    if(field==='bonusCardId'){ const c = id && state.byId.get(id); curDeck().bonusAspect = c ? (c.aspect||'') : ''; } // derived, never chosen independently
  };
  const extraIds = ()=> curDeck().deckOrder.filter(id=>{
    const c = state.byId.get(id);
    return c && echoHomeSection(c)===sec && (curDeck().deckCards.get(id)||0)>0;
  });
  const takeExtra = (id)=>{
    const n = (curDeck().deckCards.get(id)||0) - 1;
    if(n<=0){ curDeck().deckCards.delete(id); curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id); }
    else curDeck().deckCards.set(id, n);
  };
  const clearSlot = ()=>{ const next = extraIds()[0]; if(next){ takeExtra(next); setSlot(next); } else setSlot(null); };
  return {
    ids(){ const chosen = curDeck()[field]; return [...new Set([...(chosen?[chosen]:[]), ...extraIds()])]; },
    count(id){ return (curDeck()[field]===id ? 1 : 0) + (curDeck().deckCards.get(id)||0); },
    total(){ return this.ids().reduce((n,id)=> n + this.count(id), 0); },
    has(id){ return this.count(id)>0; },
    order(){ return curDeck().deckOrder; },
    setOrder(arr){ curDeck().deckOrder = arr; },
    add(ids){
      ids.forEach(id=>{
        if(!curDeck()[field]){ setSlot(id); return; }
        curDeck().deckCards.set(id, (curDeck().deckCards.get(id)||0)+1);
        if(!curDeck().deckOrder.includes(id)) curDeck().deckOrder.push(id);
      });
      toast(`Added ${ids.length} card${ids.length!==1?'s':''}.`);
    },
    removeOne(id){
      if((curDeck().deckCards.get(id)||0)>0) takeExtra(id);
      else if(curDeck()[field]===id) clearSlot();
      renderAll();
    },
    removeAll(id){
      curDeck().deckCards.delete(id); curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id);
      if(curDeck()[field]===id) clearSlot();
    },
  };
}
const ECHO_SLOT_LISTS = {
  leader: echoSlotList('leaderId', 'leader'),
  bonus:  echoSlotList('bonusCardId', 'bonus'),
  extra:  echoSlotList('extraCardId', 'extra'),
};
function echoListForSection(sec){ return sec==='schemes' ? SchemeList : (ECHO_SLOT_LISTS[sec] || null); }
// The list a card lives in, by its type; a card no longer in the live feed is found by where it's referenced.
function echoListOf(id){
  const c = state.byId.get(id);
  if(c) return echoListForSection(echoHomeSection(c));
  const d = curDeck();
  if(d.leaderId===id) return ECHO_SLOT_LISTS.leader;
  if(d.bonusCardId===id) return ECHO_SLOT_LISTS.bonus;
  if(d.extraCardId===id) return ECHO_SLOT_LISTS.extra;
  if((d.schemeIds||[]).includes(id)) return SchemeList;
  return null;
}
EchoGame.activeSideList = ()=> echoListForSection(echoActiveSection());
EchoGame.listOf = echoListOf;
EchoGame.illegalRowHint = 'Not legal for this deck — wrong type, or wrong aspect for your leader/domination aspect.';

function removeScheme(id){
  // Removes only ONE occurrence — schemeIds can now contain duplicates (sealed-deck
  // generation may add a scheme that's already present), so removing every matching
  // entry via a plain filter would silently delete all of them from one click.
  const idx = curDeck().schemeIds.indexOf(id);
  if(idx!==-1) curDeck().schemeIds.splice(idx,1);
  renderAll();
}

