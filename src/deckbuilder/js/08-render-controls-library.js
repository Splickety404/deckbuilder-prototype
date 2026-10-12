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

// Google's image CDN accepts a =w{pixels} size suffix on lh3.googleusercontent.com
// links, so we can request an appropriately-sized render instead of always pulling the
// full source resolution — dramatically cuts load time (and, for the PDF export, file
// size) for a card sourced from a PDF, where that "render" is the only way to get a
// viewable image out of it at all in the first place. But for a card whose art is
// already a standalone PNG/JPEG, asking for one more exact pixel width forces Google's
// CDN to dynamically resize it on request instead of just serving the file as-is —
// real, easy-to-notice latency (especially on hover, where the preview needs a
// different width than whatever the grid thumbnail already asked for) bought for very
// little, since these aren't a page pulled out of some huge multi-card PDF. Code.gs's
// artUrl() tags every URL it hands back with a "#img-src" or "#pdf-src" fragment
// (inert — never sent to the browser's actual request, just text this function reads
// off the string) saying which case it is, so only a URL NOT tagged as a plain image
// (a PDF, or anything untagged/legacy from before this existed) gets sized down; an
// image URL is returned as-is, fragment stripped, requesting the file at its own
// native size.
//
// The PDF export is the one caller that always wants the `force` override: it
// deliberately downsizes to a fixed print resolution (900px wide) no matter the
// source format, both to cap file size and because a native-resolution PNG can be
// print-production scale — large enough that fetching/decoding it client-side is
// what was actually failing PDF export for PNG-sourced cards. `force` skips the
// "leave images alone" branch above and always appends the width, same as a PDF.
// Cards published by the Card Updater also have a small copy of their art
// (375 px wide, a third of the download). Known small copies, by full-size link:
// whenever a picture is wanted at small-copy size or less, the small one is used.
// Cards without one (every older card) are unaffected.
const smallImageFor = new Map();
const SMALL_IMAGE_MAX_WIDTH = 400;
function noteSmallImage(url, smallUrl){
  const sm = String(smallUrl||'').trim();
  if(url && sm) smallImageFor.set(url, sm);
}
function sizedUrl(url, w, force){
  if(!url) return '';
  if(!force && w <= SMALL_IMAGE_MAX_WIDTH && smallImageFor.has(url)) url = smallImageFor.get(url);
  const isImage = !force && url.includes('#img-src');
  const base = url.split('#')[0]; // e.g. ".../d/<fileId>" or ".../d/<fileId>?v=<token>" (see Code.gs artUrl())
  if(isImage) return base;
  // The "=wNNN" size directive has to sit directly after the fileId, BEFORE any
  // "?v=..." cache-busting query string Code.gs's artUrl() may have added — Google's
  // CDN only recognizes it as a path suffix, not as part of a query string. So it's
  // inserted right before the "?", not just appended to the end of the string.
  const qIdx = base.indexOf('?');
  return qIdx === -1 ? (base + '=w' + w) : (base.slice(0, qIdx) + '=w' + w + base.slice(qIdx));
}


