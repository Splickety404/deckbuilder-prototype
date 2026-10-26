/* =========================================================================
   ECHO — DECK TABS AND "REMOVE ILLEGAL CARDS" (private). The Overlord/Champion
   tabs and the illegal-card clean-up button. Their page markup is wrapped in
   PRIVATE markers in index.html, so a public build has neither the markup nor
   this wiring. (The leader / Domination / Stronghold and the schemes are picked
   in the deck panel's sections — see 10b.)
   ========================================================================= */
const LS_LAST_DECKTYPE_KEY = 'eoo_last_decktype';
document.getElementById('deckTypeTabs').addEventListener('click', (e)=>{
  const t = e.target.closest('.tab'); if(!t) return;
  if(t.dataset.type === state.deckType) return;
  state.deckType = t.dataset.type;
  // Overlord and Champion are separate decks, built in
  state.selection = new Set();       // parallel — nothing about either one is reset here.
  localStorage.setItem(LS_LAST_DECKTYPE_KEY, state.deckType);
  renderAll();
});
const rememberedDeckType = localStorage.getItem(LS_LAST_DECKTYPE_KEY);
if(rememberedDeckType==='overlord' || rememberedDeckType==='champion') state.deckType = rememberedDeckType;

document.getElementById('btnClearIllegal').addEventListener('click', ()=>{
  // Clears illegal cards from the main deck and the scheme list alike — both show in the panel at once.
  const snapshot = { schemeIds: [...curDeck().schemeIds], deckCards: new Map(curDeck().deckCards), deckOrder: [...curDeck().deckOrder] };
  const legal = (id)=>{ const c=state.byId.get(id); return c && isLegalForCurrentPool(c); };
  let removedCount = 0;
  if(state.deckType==='overlord'){
    const before = curDeck().schemeIds.length;
    curDeck().schemeIds = curDeck().schemeIds.filter(legal);
    removedCount = before - curDeck().schemeIds.length;
  }
  for(const id of [...curDeck().deckCards.keys()]){
    if(!legal(id)){ removedCount += curDeck().deckCards.get(id); curDeck().deckCards.delete(id); curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id); }
  }
  renderAll();
  toast(`Removed ${removedCount} illegal card${removedCount!==1?'s':''}.`, 'Undo', ()=>{
    curDeck().schemeIds = snapshot.schemeIds; curDeck().deckCards = snapshot.deckCards; curDeck().deckOrder = snapshot.deckOrder;
    renderAll();
  });
});
