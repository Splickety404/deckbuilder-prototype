/* =========================================================================
   BOARD MOUSE CONTROLS + PING/POINT TOOL
     - Left-drag on empty board space → box-select (see beginBoxSelect).
       Shift adds to the current selection instead of replacing it.
     - Right-drag anywhere on the board → pan the view.
     - Right-click (no drag) → whatever was clicked's own menu: a card/stack/
       token opens its radial menu, a zone opens its editor, empty space
       opens the board menu (see openBoardRadialMenu). Each element registers
       its handler as `el._ctx` via wirePressDragClick's onContext (see
       dispatchContextClick).
     - Middle-click, or W while hovering → ping. Pinging a card or stack also
       highlights it for everyone for a moment (see flashPingHighlight);
       anywhere else just drops the ring.
     - Touch: long-press a card/token/zone for its menu, long-press empty
       space to ping, two-finger drag to pan.
   Click-vs-drag for every button is decided off mousedown/mousemove/mouseup,
   never the 'contextmenu' event — Chromium fires that right after mousedown,
   before any drag could possibly be detected (an earlier version keyed off
   it and every right-drag misfired as a click). 'contextmenu' is only used
   to silence the native menu.
   ========================================================================= */
const LONG_PRESS_MS = 500;
const PING_HIGHLIGHT_MS = 2000;
function showPing(x, y){
  const ring = document.createElement('div');
  ring.className = 'ping-ring';
  ring.style.left = x+'px'; ring.style.top = y+'px';
  document.getElementById('boardWorld').appendChild(ring);
  setTimeout(()=> ring.remove(), 1200);
}
// pieceId -> {cardIndex, until}. Kept in a map (rather than just adding a
// class to the element once) because renderBoard rebuilds every element
// from scratch on nearly every interaction — applyPingHighlight re-applies
// it to the fresh element for as long as the highlight should last.
const pingHighlights = new Map();
function flashPingHighlight(pieceId, cardIndex){
  pingHighlights.set(pieceId, {cardIndex, until: Date.now()+PING_HIGHLIGHT_MS});
  const el = document.querySelector(`.piece[data-id="${pieceId}"]`);
  if(el) applyPingHighlight(el, pieceId);
  setTimeout(()=>{
    const h = pingHighlights.get(pieceId);
    if(h && h.until<=Date.now()) pingHighlights.delete(pieceId);
    document.querySelectorAll(`.piece[data-id="${pieceId}"] .ping-highlight, .piece[data-id="${pieceId}"].ping-highlight`)
      .forEach(n=>{ if(!pingHighlights.has(pieceId)) n.classList.remove('ping-highlight'); });
  }, PING_HIGHLIGHT_MS);
}
function applyPingHighlight(el, pieceId){
  const h = pingHighlights.get(pieceId);
  if(!h || h.until<=Date.now()) return;
  const cardEl = h.cardIndex!=null ? el.querySelector(`.splay-card[data-i="${h.cardIndex}"]`) : null;
  (cardEl || el).classList.add('ping-highlight');
}
// What a ping on this piece should say in chat. Never names a card that
// isn't face up (or that the pinger can't actually see) — a ping must not
// leak hidden information.
function describePingTarget(p, cardIndex){
  if(p.kind==='image') return p.label ? `"${p.label}"` : 'a custom piece';
  if(cardIndex==null){
    const n = p.cardIds.length;
    return `a stack${p.label ? ` "${p.label}"` : ''} (${n} card${n!==1?'s':''})`;
  }
  const card = cardsById.get(p.cardIds[cardIndex]);
  const visible = p.faceStates[cardIndex] && card && !card._classified && !card._pending && card.name;
  return visible ? `"${card.name}"` : 'a face-down card';
}
function firePing(clientX, clientY){
  const world = clientToWorld(clientX, clientY);
  doAction('PING', {x:world.x, y:world.y, tab:state.currentTab});
}
// Pings whatever is under (clientX, clientY): a specific card picked out of a
// splay, a whole stack (its label, or an unsplayed pile's face — only the top
// card is visible there, so the pile is the thing being pointed at), a lone
// card, or — if nothing — just that spot on the board.
function pingAtPoint(target, clientX, clientY){
  const world = clientToWorld(clientX, clientY);
  const pieceEl = target && target.closest && target.closest('.piece');
  const p = pieceEl ? state.pieces.get(pieceEl.dataset.id) : null;
  if(!p){ doAction('PING', {x:world.x, y:world.y, tab:state.currentTab}); return; }
  let cardIndex = null;
  if(p.kind!=='image' && !target.closest('.stack-handle')){
    const splayCard = target.closest('.splay-card:not(.splay-gap)');
    if(splayCard) cardIndex = Number(splayCard.dataset.i);
    else if(p.cardIds.length===1) cardIndex = 0;
  }
  if(p.kind==='image') cardIndex = null;
  doAction('PING', {x:world.x, y:world.y, pieceId:p.id, cardIndex, desc:describePingTarget(p, cardIndex), tab:state.currentTab});
}
// Right-click (no drag) routing — walks up from whatever was clicked to the
// nearest element that registered a context handler (see wirePressDragClick's
// onContext); nothing found means empty board space.
function dispatchContextClick(target, clientX, clientY){
  const zoneEl = target && target.closest && target.closest('.zone');
  if(state.editingZoneId && !(zoneEl && zoneEl.dataset.id===state.editingZoneId)) exitZoneEdit();
  for(let n=target; n && n.id!=='boardViewport'; n=n.parentElement){
    if(n._ctx){ n._ctx({clientX, clientY, target}); return; }
  }
  openBoardRadialMenu(clientX, clientY);
}
let lastPointer = {x:-1, y:-1};
window.addEventListener('mousemove', (e)=>{ lastPointer = {x:e.clientX, y:e.clientY}; });

let leftPressState = null, rightPressState = null, middlePressState = null;
document.getElementById('boardViewport').addEventListener('mousedown', (e)=>{
  if(e.target.closest('.board-overlay')) return; // the chat panel / rotate button float over the board but aren't part of it
  if(e.button===0){
    // Pieces and tokens stop their own left mousedown before it gets here; a
    // zone lets it through unless it's the one being edited (see wireZoneDrag),
    // so a big zone still behaves like the empty board underneath it.
    if(e.target.closest('.piece') || e.target.closest('.token')) return;
    if(!e.shiftKey) clearSelection();
    leftPressState = {startX:e.clientX, startY:e.clientY, additive:e.shiftKey, dragging:false};
  } else if(e.button===2){
    rightPressState = {startX:e.clientX, startY:e.clientY, target:e.target, viewX:state.view.x, viewY:state.view.y, dragging:false};
  } else if(e.button===1){
    e.preventDefault(); // no browser autoscroll
    middlePressState = {startX:e.clientX, startY:e.clientY, target:e.target};
  }
});
window.addEventListener('mousemove', (e)=>{
  if(leftPressState && !leftPressState.dragging
     && Math.hypot(e.clientX-leftPressState.startX, e.clientY-leftPressState.startY) >= DRAG_THRESHOLD){
    leftPressState.dragging = true;
    beginBoxSelect(leftPressState.startX, leftPressState.startY, leftPressState.additive);
  }
  if(rightPressState){
    const dx = e.clientX-rightPressState.startX, dy = e.clientY-rightPressState.startY;
    if(!rightPressState.dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD){
      rightPressState.dragging = true;
      document.getElementById('boardViewport').classList.add('panning');
    }
    if(rightPressState.dragging){
      const d = rotateVector(dx, dy, state.viewRotation);
      state.view.x = rightPressState.viewX + d.x;
      state.view.y = rightPressState.viewY + d.y;
      applyView();
    }
  }
});
window.addEventListener('mouseup', (e)=>{
  if(e.button===0) leftPressState = null; // beginBoxSelect's own mouseup listener finishes a real box
  if(e.button===2 && rightPressState){
    const rp = rightPressState;
    rightPressState = null;
    document.getElementById('boardViewport').classList.remove('panning');
    if(!rp.dragging) dispatchContextClick(rp.target, e.clientX, e.clientY);
  }
  if(e.button===1 && middlePressState){
    const mp = middlePressState;
    middlePressState = null;
    if(Math.hypot(e.clientX-mp.startX, e.clientY-mp.startY) < DRAG_THRESHOLD) pingAtPoint(mp.target, e.clientX, e.clientY);
  }
});
document.getElementById('boardViewport').addEventListener('contextmenu', (e)=>{
  if(e.target.closest('.board-overlay')) return; // keep the browser's own menu in the chat box (paste, etc.)
  e.preventDefault();
});
// W pings whatever's under the cursor — same targeting as middle-click.
document.addEventListener('keydown', (e)=>{
  if(e.key.toLowerCase()!=='w' || e.ctrlKey || e.metaKey || e.altKey) return;
  if(isTextEntryFocused()) return;
  if(hoveredTokenId) return; // over a token, W adds one to it instead — see the token hotkeys
  const target = document.elementFromPoint(lastPointer.x, lastPointer.y);
  if(!target || !target.closest('#boardViewport') || target.closest('.board-overlay')) return;
  e.preventDefault();
  pingAtPoint(target, lastPointer.x, lastPointer.y);
});

// Touch: long-press → the pressed thing's menu (or a ping on empty space);
// two fingers → pan. Taps arrive as ordinary mouse clicks, so a tap on a
// card flips it exactly like a left-click does.
let longPressTimer = null, longPressStart = null, longPressFired = false, touchPan = null;
function cancelLongPress(){
  if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; }
  longPressStart = null;
}
function touchMidpoint(touches){ return {x:(touches[0].clientX+touches[1].clientX)/2, y:(touches[0].clientY+touches[1].clientY)/2}; }
document.getElementById('boardViewport').addEventListener('touchstart', (e)=>{
  longPressFired = false;
  if(e.target.closest('.board-overlay')) return;
  if(e.touches.length===2){
    cancelLongPress();
    const m = touchMidpoint(e.touches);
    touchPan = {startX:m.x, startY:m.y, viewX:state.view.x, viewY:state.view.y};
    return;
  }
  const t = e.touches[0]; if(!t) return;
  cancelLongPress();
  const target = e.target, x = t.clientX, y = t.clientY;
  longPressStart = {x, y};
  longPressTimer = setTimeout(()=>{
    longPressTimer = null;
    longPressFired = true;
    let hasCtx = false;
    for(let n=target; n && n.id!=='boardViewport'; n=n.parentElement){ if(n._ctx){ hasCtx = true; break; } }
    if(hasCtx) dispatchContextClick(target, x, y); else firePing(x, y);
  }, LONG_PRESS_MS);
}, {capture:true, passive:true});
window.addEventListener('touchmove', (e)=>{
  if(touchPan && e.touches.length===2){
    const m = touchMidpoint(e.touches);
    const d = rotateVector(m.x-touchPan.startX, m.y-touchPan.startY, state.viewRotation);
    state.view.x = touchPan.viewX + d.x;
    state.view.y = touchPan.viewY + d.y;
    applyView();
    return;
  }
  const t = e.touches[0]; if(!t || !longPressStart) return;
  if(Math.hypot(t.clientX-longPressStart.x, t.clientY-longPressStart.y) >= DRAG_THRESHOLD) cancelLongPress();
}, {passive:true});
window.addEventListener('touchend', (e)=>{
  cancelLongPress();
  if(e.touches.length<2) touchPan = null;
  // A long-press already did its thing — don't let the browser's follow-up
  // synthetic click also flip the card underneath.
  if(longPressFired){ longPressFired = false; if(e.cancelable) e.preventDefault(); }
}, {passive:false});

/* =========================================================================
   TURN ORDER TRACKER — turn order is built lazily from every player who has
   ever joined (state.players, populated via PLAYER_JOINED), in join order.
   turnIndex starts at -1 ("not started"); each Pass Turn advances by one,
   wrapping around, and the whole (turnOrder, turnIndex) pair is broadcast
   as one SET_TURN so every client's "whose turn" view always matches.
   ========================================================================= */
function passTurn(){
  let order = state.turnOrder.length ? state.turnOrder.slice() : [...state.players.keys()];
  if(!order.includes(state.playerId)) order.push(state.playerId);
  if(!order.length) return;
  const nextIndex = (state.turnIndex+1) % order.length;
  doAction('SET_TURN', {turnOrder: order, turnIndex: nextIndex});
}
document.getElementById('btnPassTurn').addEventListener('click', passTurn);
// Whose turn it is shows as a highlight on that player's chip under the chat
// (see renderPlayerCounters), rather than as its own separate label.
function renderTurnTracker(){ renderPlayerCounters(); }

/* =========================================================================
   VISIBLE GRID OVERLAY — purely a per-viewer display aid (separate from the
   existing invisible Snap to Grid), so it's local-only but persisted in
   localStorage like the hand-scale slider.
   ========================================================================= */
const LS_SHOW_GRID_KEY = 'eoo_show_grid';
const LS_GRID_SIZE_KEY = 'eoo_grid_size';
function applyGridDisplay(){
  document.getElementById('boardGrid').classList.toggle('show-grid', state.showGrid);
  document.getElementById('showGridCheckbox').checked = state.showGrid;
  document.getElementById('gridSizeInput').value = state.gridSize;
  syncGridBackground();
}
// Keeps #boardGrid's own background-size/position lined up with the current
// pan/zoom (state.view.x/y/scale) and with world coordinate (0,0), so the
// grid lines land exactly on the multiples of state.gridSize that
// snapCoord-style snapping would actually snap to, panning and zooming
// smoothly along with everything else in #boardWorld even though the grid
// itself lives on a separate, plainly-sized element (see the CSS comment on
// #boardGrid for why it has to).
const GRID_OVERSCAN = 1000; // see #boardGrid's CSS
function syncGridBackground(){
  const grid = document.getElementById('boardGrid');
  if(!grid) return;
  const size = Math.max(1, state.gridSize * state.view.scale);
  grid.style.backgroundSize = `${size}px ${size}px`;
  grid.style.backgroundPosition = `${state.view.x + GRID_OVERSCAN}px ${state.view.y + GRID_OVERSCAN}px`;
}
function initGridDisplay(){
  const storedShow = localStorage.getItem(LS_SHOW_GRID_KEY);
  const storedSize = Number(localStorage.getItem(LS_GRID_SIZE_KEY));
  state.showGrid = storedShow === '1';
  state.gridSize = storedSize>=20 && storedSize<=300 ? storedSize : 80;
  applyGridDisplay();
}
document.getElementById('showGridCheckbox').addEventListener('change', (e)=>{
  state.showGrid = e.target.checked;
  localStorage.setItem(LS_SHOW_GRID_KEY, state.showGrid?'1':'0');
  applyGridDisplay();
});
document.getElementById('gridSizeInput').addEventListener('change', (e)=>{
  const v = Math.max(20, Math.min(300, Number(e.target.value)||80));
  state.gridSize = v;
  localStorage.setItem(LS_GRID_SIZE_KEY, String(v));
  applyGridDisplay();
});

