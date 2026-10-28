/* =========================================================================
   MASTER RENDER
   ========================================================================= */
function renderAll(){
  state.game.renderTabs();
  renderDeckControls();
  renderSortOptions();
  renderFilters();
  renderLibrary();
  renderDeckPanel();
}

/* =========================================================================
   EVENTS
   ========================================================================= */
document.getElementById('sortSelect').addEventListener('change', (e)=>{
  state.sortField = e.target.value;
  curDeck().viewArrangement = null; // picking a sort undoes any hand arrangement
  renderSortOptions();
  renderLibrary();
});

/* Deck View: drag cards within the grid to arrange them. A thin bar on the left or right
   edge of the card under the cursor shows where the dragged cards will land. */
const libraryGrid = document.getElementById('library-grid');
let arrangeTarget = null;
function clearArrangeMark(){
  if(arrangeTarget) arrangeTarget.classList.remove('arrange-before','arrange-after');
  arrangeTarget = null;
}
libraryGrid.addEventListener('dragover', (e)=>{
  if(!curFilters().deckViewOnly) return;
  const tile = e.target.closest('.card-tile');
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if(tile!==arrangeTarget) clearArrangeMark();
  if(!tile) return;
  const r = tile.getBoundingClientRect();
  const before = e.clientX < r.left + r.width/2;
  tile.classList.toggle('arrange-before', before);
  tile.classList.toggle('arrange-after', !before);
  arrangeTarget = tile;
});
libraryGrid.addEventListener('dragleave', (e)=>{ if(!libraryGrid.contains(e.relatedTarget)) clearArrangeMark(); });
libraryGrid.addEventListener('drop', (e)=>{
  if(!curFilters().deckViewOnly) return;
  e.preventDefault();
  const tile = arrangeTarget, after = tile && tile.classList.contains('arrange-after');
  clearArrangeMark();
  let ids;
  try{ ids = JSON.parse(e.dataTransfer.getData('text/plain')); }catch(err){ return; }
  if(!Array.isArray(ids)) return; // a deck-list row, not a card from the grid
  let beforeId = null;
  if(tile){
    const order = state.visibleCardsOrder, i = order.indexOf(tile.dataset.id);
    beforeId = after ? order.slice(i+1).find(id=> !ids.includes(id)) || null : tile.dataset.id;
  }
  arrangeDeckView(ids, beforeId);
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
  state.filtersByType[activeFilterKey()] = freshFilters();
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
    const side = state.game.listOf(payload.id);
    const orderArr = side ? side.order() : curDeck().deckOrder;
    const filtered = orderArr.filter(x=>x!==payload.id);
    filtered.push(payload.id);
    if(side) side.setOrder(filtered); else curDeck().deckOrder = filtered;
    renderAll();
  } else if(Array.isArray(payload)){
    addCardsToDeck(payload);
  }
});

document.getElementById('btnResync').addEventListener('click', ()=> loadData(false));

