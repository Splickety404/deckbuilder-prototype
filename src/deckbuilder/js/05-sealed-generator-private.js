/* =========================================================================
   SEALED DECK GENERATOR — the button and set picker for building one Saga deck
   (the prebuilt "starter" deck) for whichever side is being viewed. The rules
   themselves (rarity rolls, aspect legality, copy limits…) are in
   src/shared/js/sealed-rules-private.js, shared with the game room.
   ========================================================================= */
function deckCountOf(slot){ let n=0; for(const v of slot.deckCards.values()) n+=v; return n; }

// The rules themselves live in src/shared/js/sealed-rules-private.js (shared with the game room).
function generateSagaDeck(setName, deckType){
  const bySet = (c) => (c._setNames && c._setNames.length) ? c._setNames.includes(setName) : c._setName===setName;
  const res = buildSagaDeck(state.cards, deckType, bySet);
  if(res.error){ toast(res.error); return; }
  const d = res.deck;
  const slot = freshDeckSlot();
  slot.leaderId = d.leaderId;
  if(d.bonusCardId){ slot.bonusCardId = d.bonusCardId; slot.bonusAspect = d.bonusAspect; }
  if(d.extraCardId) slot.extraCardId = d.extraCardId;
  d.schemeIds.forEach(id=>slot.schemeIds.push(id));
  d.deckCards.forEach((n,id)=>slot.deckCards.set(id,n));
  d.deckOrder.forEach(id=>slot.deckOrder.push(id));

  // Animation plan: every card of the new deck flies in from the button (see 05d).
  const byId = (id)=>state.byId.get(id);
  const moves = [];
  if(slot.leaderId) moves.push({card:byId(slot.leaderId), side:deckType, slot:'deck-leader-slot'});
  if(slot.bonusCardId) moves.push({card:byId(slot.bonusCardId), side:deckType, slot:'deck-bonus-slot'});
  if(slot.extraCardId) moves.push({card:byId(slot.extraCardId), side:deckType, slot:'deck-extra-slot'});
  slot.deckOrder.forEach(id=>{ for(let i=0;i<(slot.deckCards.get(id)||0);i++) moves.push({card:byId(id), key:deckType}); });
  slot.schemeIds.forEach(id=>moves.push({card:byId(id), key:'scheme'}));
  FlyCards.begin(deckType==='overlord' ? ['overlord','scheme'] : [deckType]); // the old deck is being replaced: counts start from 0

  state.decks[deckType] = slot;
  renderAll();
  FlyCards.run(document.getElementById('btnSealedDeck'), moves.filter(m=>m.card));
  const total = 1 + (res.hasBonus?1:0) + deckCountOf(slot) + slot.schemeIds.length; // leader + Domination/Quest + cards
  const expected = d.expectedSize;
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
