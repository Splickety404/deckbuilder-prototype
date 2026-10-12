/* =========================================================================
   MASTER RENDER
   ========================================================================= */
function renderAll(){
  renderTabs();
  renderDeckControls();
  renderSortOptions();
  renderFilters();
  renderLibrary();
  renderDeckPanel();
}

/* =========================================================================
   EVENTS
   ========================================================================= */
const LS_LAST_DECKTYPE_KEY = 'eoo_last_decktype';
document.getElementById('deckTypeTabs').addEventListener('click', (e)=>{
  const t = e.target.closest('.tab'); if(!t) return;
  if(t.dataset.type === state.deckType) return;
  state.deckType = t.dataset.type;   // Overlord and Champion are separate decks, built in
  state.selection = new Set();       // parallel — nothing about either one is reset here.
  localStorage.setItem(LS_LAST_DECKTYPE_KEY, state.deckType);
  renderAll();
});

document.getElementById('overlordModeToggle').addEventListener('click', (e)=>{
  const t = e.target.closest('.tab'); if(!t) return;
  curDeck().overlordMode = t.dataset.mode;
  state.selection = new Set();
  renderAll();
});

document.getElementById('deck-leader-slot').addEventListener('click', openLeaderModal);
document.getElementById('deck-bonus-slot').addEventListener('click', openBonusCardModal);
document.getElementById('deck-extra-slot').addEventListener('click', openExtraCardModal);
// Generic single-card picker — backs the Leader, Domination/Quest, and
// Stronghold/Resistance selections alike.
function openCardPickerModal({title, pool, currentId, onPick}){
  document.getElementById('cardPickerTitle').textContent = title;
  const grid = document.getElementById('cardPickerGrid');
  grid.innerHTML = pool.map(c=>{
    const imgHtml = cardImageHtml(c, '', 320); // reuses the same rotation-aware rendering as everywhere else
    return `
    <div class="leader-pick-tile${c.id===currentId?' selected':''}" data-id="${c.id}">
      ${imgHtml || `<div class="fallback-face" style="background:${colorForAspect(c.aspect)}33;"><div class="fname">${escapeHtml(c.name)}</div><div class="ftype">${escapeHtml(c.aspect)}</div></div>`}
      <div class="lname">${escapeHtml(c.name)}</div>
      <div style="display:flex;justify-content:center;gap:4px;padding:0 6px 8px 6px;">
        ${(c._doubleSided && c._back) ? `<div class="btn btn-sm" data-act="flip">Flip</div>` : ''}
        <div class="btn btn-sm" data-act="detail">Details</div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.leader-pick-tile').forEach(t=>{
    const id = t.dataset.id;
    t.querySelector('[data-act=detail]').addEventListener('click', (e)=>{
      e.stopPropagation();
      openPreview(state.byId.get(id));
    });
    const flipBtn = t.querySelector('[data-act=flip]');
    if(flipBtn) flipBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      toggleCardFlip(id);
      openCardPickerModal({title, pool, currentId, onPick}); // rebuild in place so this same modal reflects the flip
    });
    t.addEventListener('click', ()=>{
      onPick(id);
      document.getElementById('cardPickerModal').classList.add('hidden');
      renderAll();
    });
  });
  document.getElementById('cardPickerModal').classList.remove('hidden');
  layoutAllSchemeFrames(grid); // must run after the modal is visible, or clientWidth reads 0 and sizing silently no-ops
}

function openLeaderModal(){
  openCardPickerModal({
    title: 'Choose your leader',
    pool: state.cards.filter(c=>c.type===leaderTypeName(state.deckType) && cardVisibleBySet(c)),
    currentId: curDeck().leaderId,
    onPick: (id) => { curDeck().leaderId = id; },
  });
}

function openBonusCardModal(){
  const isOverlord = state.deckType==='overlord';
  openCardPickerModal({
    title: isOverlord ? 'Choose your Domination card' : 'Choose your Quest card',
    pool: state.cards.filter(c=>c.type===bonusCardTypeName(state.deckType) && cardVisibleBySet(c)),
    currentId: curDeck().bonusCardId,
    onPick: (id) => {
      curDeck().bonusCardId = id;
      const card = state.byId.get(id);
      curDeck().bonusAspect = card ? (card.aspect||'') : ''; // derived, never chosen independently
    },
  });
}

function openExtraCardModal(){
  const isOverlord = state.deckType==='overlord';
  // Same allowance the sealed-deck generator uses: a Z-Custom placeholder isn't
  // tagged with any real set, so it stays available regardless of which set(s) are
  // checked — otherwise checking only a set with no real Stronghold/Resistance card
  // yet would leave this picker empty for no good reason.
  openCardPickerModal({
    title: isOverlord ? 'Choose your Stronghold' : 'Choose your Resistance',
    pool: extraCardPool(state.deckType).filter(c=>cardVisibleBySet(c) || c.type==='Z - Custom'),
    currentId: curDeck().extraCardId,
    onPick: (id) => { curDeck().extraCardId = id; },
  });
}


document.getElementById('sortSelect').addEventListener('change', (e)=>{
  state.sortField = e.target.value;
  renderLibrary();
});

document.getElementById('btnClearIllegal').addEventListener('click', ()=>{
  const snapshot = activeIsSchemeMode()
    ? { schemeIds: [...curDeck().schemeIds] }
    : { deckCards: new Map(curDeck().deckCards), deckOrder: [...curDeck().deckOrder] };
  let removedCount = 0;
  if(activeIsSchemeMode()){
    const before = curDeck().schemeIds.length;
    curDeck().schemeIds = curDeck().schemeIds.filter(id=>{ const c=state.byId.get(id); return c && isLegalForCurrentPool(c); });
    removedCount = before - curDeck().schemeIds.length;
  } else {
    for(const id of [...curDeck().deckCards.keys()]){
      const c = state.byId.get(id);
      if(!c || !isLegalForCurrentPool(c)){ removedCount += curDeck().deckCards.get(id); curDeck().deckCards.delete(id); curDeck().deckOrder = curDeck().deckOrder.filter(x=>x!==id); }
    }
  }
  renderAll();
  toast(`Removed ${removedCount} illegal card${removedCount!==1?'s':''}.`, 'Undo', ()=>{
    if(activeIsSchemeMode()) curDeck().schemeIds = snapshot.schemeIds;
    else { curDeck().deckCards = snapshot.deckCards; curDeck().deckOrder = snapshot.deckOrder; }
    renderAll();
  });
});

document.getElementById('searchBox').addEventListener('input', (e)=>{
  curFilters().search = e.target.value;
  renderFilters(); renderLibrary();
});
document.getElementById('deckViewCheckbox').addEventListener('change', (e)=>{
  curFilters().deckViewOnly = e.target.checked;
  renderAll();
});
document.getElementById('btnClearFilters').addEventListener('click', ()=>{
  state.filtersByType[activeFilterKey()] = {search:'', multi:{}, range:{}, deckViewOnly:false, hiddenSets:new Set()};
  document.getElementById('searchBox').value='';
  renderAll();
});

document.querySelectorAll('[data-close]').forEach(b=>{
  b.addEventListener('click', ()=> document.getElementById(b.dataset.close).classList.add('hidden'));
});

document.getElementById('btnThemeToggle').addEventListener('click', ()=>{
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur==='dark' ? 'light' : 'dark');
});

document.getElementById('deckNameInput').addEventListener('input', (e)=>{ curDeck().name = e.target.value; });

document.getElementById('btnNewDeck').addEventListener('click', ()=>{
  if(!confirm('Start a new deck? Unsaved changes will be lost.')) return;
  state.decks[activeDeckKey()] = freshDeckSlot();
  renderAll();
});
/* deck drop zone: only fires for drops NOT on a specific row (row handlers stopPropagation) */
const dropZone = document.getElementById('deck-drop-zone');
dropZone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropZone.classList.add('dragover'); showReorderIndicatorAt(dropZone, null); });
dropZone.addEventListener('dragleave', ()=> dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e)=>{
  e.preventDefault(); dropZone.classList.remove('dragover'); hideReorderIndicator();
  let payload;
  try{ payload = JSON.parse(e.dataTransfer.getData('text/plain')); }catch(err){ return; }
  if(payload && payload.reorder){
    const orderArr = activeIsSchemeMode() ? curDeck().schemeIds : curDeck().deckOrder;
    const filtered = orderArr.filter(x=>x!==payload.id);
    filtered.push(payload.id);
    if(activeIsSchemeMode()) curDeck().schemeIds = filtered; else curDeck().deckOrder = filtered;
    renderAll();
  } else if(Array.isArray(payload)){
    addCardsToDeck(payload);
  }
});

document.getElementById('btnResync').addEventListener('click', ()=> loadData(false));

/* =========================================================================
   PLAYTEST ROOM LINK + BOARD (.pcio) DOWNLOAD
   ========================================================================= */
// This opens the template page with the "Blank Game" button front and center,
// rather than trying to create a room directly. That button's actual room
// creation happens through playingcards.io's own backend (looks Firebase-backed,
// not a plain link or documented API) — nothing externally callable to hook into
// safely, so one extra click here is the honest, durable tradeoff.
const PLAYTEST_ROOM_URL = 'https://playingcards.io/@playingcardsio/standard-52-card-deck-game';
(function wirePlaytestRoomLink(){
  const el = document.getElementById('btnPlaytestRoom');
  el.href = PLAYTEST_ROOM_URL;
})();

// state.pcio is already known (resolved once per game load, from the game's own main
// folder — see loadData/applyPcioUI) so there's no need for a separate round trip
// here; the button itself is hidden entirely whenever state.pcio.found is false.
document.getElementById('btnDownloadPcio').addEventListener('click', ()=>{
  if(!state.pcio || !state.pcio.found){ toast('No .pcio file found for this game.'); return; }
  window.open(state.pcio.downloadUrl, '_blank');
});


