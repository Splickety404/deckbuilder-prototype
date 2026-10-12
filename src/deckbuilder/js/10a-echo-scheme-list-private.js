/* =========================================================================
   ECHO — SCHEME DECK LIST (private). While the Overlord's "Scheme" tab is open
   the deck panel edits a second list (schemeIds, duplicates allowed) instead of
   the main deck. The shared panel only knows "is a side list active?" — see
   activeSideList in the game definition — and asks it to render / reorder /
   add / remove. Moved here unchanged from the deck panel.
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
EchoGame.activeSideList = ()=> activeIsSchemeMode() ? SchemeList : null;
EchoGame.illegalRowHint = 'Not legal for this deck — wrong type, or wrong aspect for your leader/domination aspect.';

function removeScheme(id){
  // Removes only ONE occurrence — schemeIds can now contain duplicates (sealed-deck
  // generation may add a scheme that's already present), so removing every matching
  // entry via a plain filter would silently delete all of them from one click.
  const idx = curDeck().schemeIds.indexOf(id);
  if(idx!==-1) curDeck().schemeIds.splice(idx,1);
  renderAll();
}

