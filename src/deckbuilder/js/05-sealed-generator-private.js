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

  state.decks[deckType] = slot;
  renderAll();
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
