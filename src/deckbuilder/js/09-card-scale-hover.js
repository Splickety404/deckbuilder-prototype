/* =========================================================================
   CARD SCALE — user-adjustable grid tile size, persisted per-browser
   ========================================================================= */
function gridImageFetchWidth(){
  // keeps roughly the same ratio the app already used at the old fixed 170px tile
  // size (320/170 ≈ 1.88) — so a smaller chosen card size also fetches a smaller
  // image (faster), and a larger one fetches a crisper one, rather than always
  // pulling the same fixed resolution regardless of how big the tile actually is.
  return Math.round(state.cardScale * 1.88);
}
function applyCardScale(px){
  state.cardScale = px;
  document.documentElement.style.setProperty('--card-min-width', px+'px');
  document.getElementById('cardScaleSlider').value = px;
}
function initCardScale(){
  const stored = Number(localStorage.getItem(LS_CARD_SCALE_KEY));
  const px = (stored && stored>=CARD_SCALE_MIN && stored<=CARD_SCALE_MAX) ? stored : CARD_SCALE_DEFAULT;
  applyCardScale(px);
}
let cardScaleDebounceTimer = null;
document.getElementById('cardScaleSlider').addEventListener('input', (e)=>{
  const px = Number(e.target.value);
  applyCardScale(px); // instant CSS resize — no need to wait for the debounce below
  clearTimeout(cardScaleDebounceTimer);
  cardScaleDebounceTimer = setTimeout(()=>{
    localStorage.setItem(LS_CARD_SCALE_KEY, String(px));
    renderLibrary(); // re-fetches images at the new size-appropriate resolution
  }, 400);
});


// Scheme cards need their art rotated within a landscape frame (see CSS); everything
// else is a plain <img>. Used everywhere a card image renders so the fix lives in one place.
// Which side of a card is currently displayed — only ever true for cards flagged
// double-sided (currently just leaders, but driven by the data flag rather than
// hardcoded, so any future double-sided card picks this up automatically).
function isShowingBack(card){ return !!(card && card._doubleSided && card._back && state.flippedCards.has(card.id)); }
function toggleCardFlip(cardId){
  state.flippedCards.has(cardId) ? state.flippedCards.delete(cardId) : state.flippedCards.add(cardId);
}
function displayImageUrl(card){ return card ? (isShowingBack(card) ? card._back : card._front) : ''; }

function cardImageHtml(card, extraAttrs, width){
  const url = displayImageUrl(card);
  if(!url) return '';
  const attrs = extraAttrs||'';
  const src = escapeHtml(sizedUrl(url, width||320));
  if(card._isHorizontal){
    const fillClass = card._rotate===270 ? 'rotate-270-fill' : 'rotate-90-fill';
    return `<div class="landscape-frame"><img class="${fillClass}" src="${src}" ${attrs}></div>`;
  }
  if(card._rotate===180) return `<img class="rotate-180-fill" src="${src}" ${attrs}>`;
  return `<img src="${src}" ${attrs}>`;
}

/* CSS aspect-ratio + rotated-absolute-positioning is fragile across browsers for making
   a rotated image exactly fill a differently-shaped box, and was overflowing its frame.
   Instead: measure the frame's actual rendered pixels and set the pre-rotation image's
   width/height explicitly (swapped) so a -90° rotation lands on an exact pixel match,
   every time, regardless of browser quirks. */
function layoutSchemeFrame(frame){
  const img = frame.querySelector('img');
  if(!img) return;
  const w = frame.clientWidth, h = frame.clientHeight;
  if(!w || !h) return;
  img.style.width = h + 'px';
  img.style.height = w + 'px';
}
function layoutAllSchemeFrames(root){
  (root||document).querySelectorAll('.landscape-frame, .hp-frame.scheme, .hp-frame.scheme270, #preview-img-frame.scheme, #preview-img-frame.scheme270').forEach(layoutSchemeFrame);
}
window.addEventListener('resize', ()=>{ clearTimeout(window.__eooResizeT); window.__eooResizeT=setTimeout(()=>layoutAllSchemeFrames(document), 120); });

function mkBtn(label, onClick){
  const b=document.createElement('div');
  b.className='tile-btn'; b.textContent=label;
  b.addEventListener('click',(e)=>{ e.stopPropagation(); onClick(); });
  b.addEventListener('mousedown',(e)=>e.stopPropagation());
  return b;
}

/* selection: click / shift-click / ctrl-click */
function onTileClick(e, id){
  const order = state.visibleCardsOrder;
  const idx = order.indexOf(id);
  if(e.shiftKey && state.lastClickIndex!==null){
    const [a,b] = [state.lastClickIndex, idx].sort((x,y)=>x-y);
    state.selection = new Set(order.slice(a,b+1));
  } else if(e.ctrlKey || e.metaKey){
    state.selection.has(id) ? state.selection.delete(id) : state.selection.add(id);
    state.lastClickIndex = idx;
  } else {
    state.selection = new Set([id]);
    state.lastClickIndex = idx;
  }
  renderLibrary();
}

function onTileDragStart(e, id){
  let ids;
  if(state.selection.has(id) && state.selection.size>1){ ids=[...state.selection]; }
  else {
    ids=[id];
    state.selection=new Set([id]);
    // Deferred: mutating the grid's DOM synchronously inside dragstart can remove the
    // node mid-drag and cancel the operation in some browsers (this was the cause of
    // "only works once 2+ cards are selected" — the >1 branch above never re-renders).
    setTimeout(renderLibrary, 0);
  }
  e.dataTransfer.setData('text/plain', JSON.stringify(ids));
  e.dataTransfer.effectAllowed='copy';
}

/* =========================================================================
   HOVER PREVIEW
   ========================================================================= */
let hoverTimer=null;
// Safe to call repeatedly on the SAME persistent element (unlike grid tiles, which are
// freshly created each render, chip elements like the leader slot persist — only their
// innerHTML changes — so this must replace any previously-wired listener rather than
// stacking a new one on top each time).
function wireHoverPreview(el, card){
  if(el._hoverEnterHandler) el.removeEventListener('mouseenter', el._hoverEnterHandler);
  if(el._hoverLeaveHandler) el.removeEventListener('mouseleave', el._hoverLeaveHandler);
  el._hoverEnterHandler = () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(()=>showHoverPreview(el, card), 450);
  };
  el._hoverLeaveHandler = () => { clearTimeout(hoverTimer); hideHoverPreview(); };
  el.addEventListener('mouseenter', el._hoverEnterHandler);
  el.addEventListener('mouseleave', el._hoverLeaveHandler);
}
function showHoverPreview(el, card){
  const url = displayImageUrl(card);
  if(!card || !url) return;
  const hp = document.getElementById('hover-preview');
  const imgEl = document.getElementById('hoverPreviewImg');
  const frameEl = document.getElementById('hoverPreviewFrame');
  imgEl.removeAttribute('src'); // clear immediately — otherwise the previous card's bitmap stays visible until the new one finishes loading
  imgEl.src = sizedUrl(url, HOVER_FETCH_WIDTH);
  const is270 = card._isHorizontal && card._rotate===270;
  frameEl.classList.toggle('scheme', !!card._isHorizontal && !is270);
  frameEl.classList.toggle('scheme270', is270);
  hp.classList.toggle('scheme', !!card._isHorizontal && !is270);
  hp.classList.toggle('scheme270', is270);
  imgEl.classList.toggle('rotate-180-fill', !card._isHorizontal && card._rotate===180);
  if(!card._isHorizontal){ imgEl.style.width=''; imgEl.style.height=''; } // clear any stale sizing from a prior rotated preview
  document.getElementById('hoverPreviewName').textContent = card.name;
  const rect = el.getBoundingClientRect();
  const boxWidth = card._isHorizontal ? HOVER_PREVIEW_SCHEME_WIDTH : HOVER_PREVIEW_WIDTH;
  const boxHeight = (card._isHorizontal ? boxWidth*5/7 : boxWidth*7/5) + 40; // + ~name/padding overhead
  let left = rect.right + 12;
  if(left + boxWidth + 16 > window.innerWidth) left = rect.left - boxWidth - 16;
  let top = Math.max(8, Math.min(rect.top, window.innerHeight-boxHeight-8));
  hp.style.left = left+'px'; hp.style.top = top+'px';
  hp.style.display = 'block';
  if(card._isHorizontal) layoutSchemeFrame(frameEl);
}
function hideHoverPreview(){ document.getElementById('hover-preview').style.display='none'; }

