/* =========================================================================
   RENDER: TOP CONTROLS / DECK CONTROLS
   ========================================================================= */
function renderDeckControls(){
  document.getElementById('deckNameInput').value = curDeck().name || '';
  const summary = state.game.deckSummary();
  document.getElementById('deckPanelTitle').textContent = summary.title;
  const cl = document.getElementById('deckCountLabel');
  cl.textContent = summary.text;
  cl.className = summary.bad ? 'bad' : '';
  state.game.renderDeckControlsExtras();
}

/* =========================================================================
   RENDER: LIBRARY GRID
   ========================================================================= */
function renderLibrary(){
  const grid = document.getElementById('library-grid');
  let pool = poolForCurrentMode().filter(c=>cardMatchesFilters(c));
  pool = sortPool(pool);
  state.visibleCardsOrder = pool.map(c=>c.id);
  document.getElementById('library-count').textContent = `${pool.length} card${pool.length!==1?'s':''}`;

  grid.innerHTML='';
  if(!state.cards.length){
    grid.innerHTML = `<div style="grid-column:1/-1;padding:40px 20px;text-align:center;color:var(--text-soft);">
      No card sets are loaded yet. Click <b>Sets</b> in the top bar to enable Set 1 or import another set.
    </div>`;
    state.game.renderViewStats();
    return;
  }
  const frag = document.createDocumentFragment();
  pool.forEach((c)=>{
    const tile = document.createElement('div');
    const legal = isLegalForCurrentPool(c);
    tile.className = 'card-tile' + (c._isHorizontal?' scheme-card':'') + (!legal?' illegal':'');
    if(!legal) tile.title = state.game.illegalHint;
    tile.draggable = true;
    tile.dataset.id = c.id;
    if(state.selection.has(c.id)) tile.classList.add('selected');

    if(displayImageUrl(c)){
      tile.innerHTML = `${cardImageHtml(c, `loading="lazy" alt="${escapeHtml(c.name)}"`, gridImageFetchWidth())}
                         <div class="name-bar">${escapeHtml(c.name)}</div>`;
    } else {
      tile.innerHTML = `<div class="fallback-face" style="background:${colorForAspect(c.aspect)}22;">
                           <div class="fname">${escapeHtml(c.name)}</div>
                           <div class="ftype">${escapeHtml(c.type)} ${c.aspect?'· '+escapeHtml(c.aspect):''}</div>
                           <div class="fability">${escapeHtml((c.ability||'').slice(0,160))}</div>
                         </div>
                         <div class="name-bar">${escapeHtml(c.name)}</div>`;
    }

    const countIn = state.game.listCount(c.id);
    if(countIn>0){
      const badge=document.createElement('div');
      badge.className='count-badge';
      badge.textContent = '×'+countIn; // numeric for both modes now — schemes are no longer capped at one
      tile.appendChild(badge);
    }
    if(isRecentlyUpdated(c)){
      const dot=document.createElement('div');
      dot.className='updated-dot';
      dot.textContent='Updated';
      tile.appendChild(dot);
    }

    const actions = document.createElement('div'); actions.className='tile-actions';
    actions.appendChild(mkBtn('+', ()=>addCardsToDeck([c.id])));
    if(countIn>0) actions.appendChild(mkBtn('−', ()=>state.game.removeOne(c.id)));
    if(c._doubleSided && c._back) actions.appendChild(mkBtn('⟲', ()=>{ toggleCardFlip(c.id); renderLibrary(); }));
    actions.appendChild(mkBtn('…', ()=>openPreview(c)));
    tile.appendChild(actions);

    tile.addEventListener('click', (e)=>onTileClick(e, c.id));
    tile.addEventListener('dragstart', (e)=>onTileDragStart(e, c.id));
    wireHoverPreview(tile, c);
    frag.appendChild(tile);
  });
  grid.appendChild(frag);
  layoutAllSchemeFrames(grid);
  state.game.renderViewStats();
}

function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Art links are resized (and small copies preferred) by the card source, since only it knows how
// its image host works — see cardSource.sizedUrl / noteSmallImage. These two wrappers are what the
// rest of the app calls.
function noteSmallImage(url, smallUrl){ cardSource.noteSmallImage(url, smallUrl); }
function sizedUrl(url, w, force){ return cardSource.sizedUrl(url, w, force); }


