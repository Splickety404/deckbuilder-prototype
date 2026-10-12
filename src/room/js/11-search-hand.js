/* =========================================================================
   SEARCH — shows every card's FRONT (regardless of its current face state, since
   you're rifling through looking for something) to the searching player only.
   Selected cards can go to hand or onto the board (face up, since finding and
   placing it is the point). Other players see a count-only notification.
   ========================================================================= */
// Search (Q / Stack menu) = the whole pile; peek mode (hold A + a number) =
// just the top N. Either way it's private to you, and the table sees who is
// looking at which pile for as long as the panel stays open (SEARCH_START/END).
var pileBrowser = null; // {pieceId, count} — count null = the whole pile. `var` (hoisted): renderBoard, defined earlier, reads it
function openSearchModal(pieceId){ openPileBrowser(pieceId, null); }
function openPileBrowser(pieceId, count){
  const p = state.pieces.get(pieceId); if(!p || p.kind==='image' || !p.cardIds.length) return;
  closeRadialMenu();
  if(pileBrowser) closePileBrowser();
  pileBrowser = {pieceId, count: count==null ? null : Math.min(count, p.cardIds.length)};
  document.getElementById('pileBrowser').classList.remove('hidden');
  renderPileBrowser();
  doAction('SEARCH_START', {id:pieceId, playerName:state.playerName, count:pileBrowser.count});
}
function closePileBrowser(){
  if(!pileBrowser) return;
  const id = pileBrowser.pieceId;
  pileBrowser = null;
  document.getElementById('pileBrowser').classList.add('hidden');
  doAction('SEARCH_END', {id, playerName:state.playerName});
}
document.getElementById('btnPileBrowserClose').addEventListener('click', closePileBrowser);
wirePopoverDrag(document.getElementById('pileBrowser'), document.querySelector('#pileBrowser .popover-drag'));
// The pile indexes being shown, top card first.
function pileBrowserIndexes(p){
  const n = p.cardIds.length;
  const count = pileBrowser.count==null ? n : Math.min(pileBrowser.count, n);
  return Array.from({length:count}, (_,k)=> n-1-k);
}
function renderPileBrowser(){
  if(!pileBrowser) return;
  const p = state.pieces.get(pileBrowser.pieceId);
  if(!p || !p.cardIds.length || (pileBrowser.count!=null && pileBrowser.count<=0)){ closePileBrowser(); return; }
  const idxs = pileBrowserIndexes(p);
  const name = p.label ? `"${p.label}"` : 'this pile';
  document.getElementById('pileBrowserTitle').textContent = pileBrowser.count==null
    ? `Searching ${name} — ${p.cardIds.length} card${p.cardIds.length===1?'':'s'}`
    : `Top ${idxs.length} of ${name}`;
  const list = document.getElementById('pileBrowserList');
  list.innerHTML = idxs.map((i,k)=>`<div class="pb-card" data-idx="${i}">
      <div class="face">${cardFrontInnerHtml(cardsById.get(p.cardIds[i]), 240)}</div>
      <div class="pb-pos">${k===0 ? 'Top' : '#'+(k+1)}${i===0 && idxs.length===p.cardIds.length ? ' · Bottom' : ''}</div>
      <div class="pb-actions">
        <div class="btn" data-act="top" title="Put on top of the pile">⤒</div>
        <div class="btn" data-act="bottom" title="Put on the bottom of the pile">⤓</div>
        <div class="btn" data-act="hand" title="Take into your hand">✋</div>
      </div></div>`).join('');
  list.querySelectorAll('.pb-card').forEach(el=>{
    const i = Number(el.dataset.idx);
    wireHoverPreview(el.querySelector('.face'), ()=>({card:cardsById.get(p.cardIds[i]), faceUp:true})); // private — you're already looking
    el.querySelectorAll('[data-act]').forEach(b=> b.addEventListener('click', (e)=>{ e.stopPropagation(); pileBrowserAction(i, b.dataset.act); }));
    wirePileBrowserDrag(el, i);
  });
}
// In "top N" mode a card that leaves the top of the pile leaves the view too.
function pileBrowserShrink(){ if(pileBrowser && pileBrowser.count!=null) pileBrowser.count--; }
function pileBrowserAction(i, act){
  const pieceId = pileBrowser.pieceId;
  const p = state.pieces.get(pieceId); if(!p) return;
  if(act==='hand'){ pileBrowserShrink(); drawTopCard(pieceId, 'hand', i); }
  else if(act==='top') moveCardWithinPile(pieceId, i, p.cardIds.length-1);
  else if(act==='bottom'){ if(pileBrowser.count!=null && pileBrowser.count<p.cardIds.length) pileBrowserShrink(); moveCardWithinPile(pieceId, i, 0); }
  renderPileBrowser();
}
// Moves one card to a new position in the same pile (0 = bottom). One synced,
// undoable REORDER_PIECE.
function moveCardWithinPile(pieceId, from, to){
  const p = state.pieces.get(pieceId); if(!p || from===to) return;
  const rot = p.cardRotations || p.cardIds.map(()=>0);
  const original = {cardIds:[...p.cardIds], faceStates:[...p.faceStates], cardRotations:[...rot]};
  const order = p.cardIds.map((_,k)=>k);
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(to, order.length)), 0, from);
  doAction('REORDER_PIECE', {id:pieceId, cardIds:order.map(k=>p.cardIds[k]), faceStates:order.map(k=>p.faceStates[k]), cardRotations:order.map(k=>rot[k])});
  setUndo(()=> doAction('RESTORE_PIECE_CARDS', {id:pieceId, ...original}));
}
// Drag a card out of the browser: onto another card here = reorder (it goes
// just above that card); onto your hand = take it; onto the board = place it
// face up there (joining a pile if dropped on one, like any other card drag).
function wirePileBrowserDrag(el, i){
  el.addEventListener('mousedown', (e)=>{
    if(e.button!==0 || e.target.closest('[data-act]')) return;
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let ghost = null;
    const clearMarks = ()=> document.querySelectorAll('.pb-card.drop-before').forEach(c=>c.classList.remove('drop-before'));
    function move(ev){
      if(!ghost){
        if(Math.hypot(ev.clientX-startX, ev.clientY-startY) < DRAG_THRESHOLD) return;
        ghost = document.createElement('div'); ghost.className = 'pb-ghost';
        ghost.innerHTML = el.querySelector('.face').innerHTML;
        document.body.appendChild(ghost);
        hideHoverPreview();
      }
      ghost.style.left = (ev.clientX-39)+'px'; ghost.style.top = (ev.clientY-55)+'px';
      clearMarks();
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const overCard = over && over.closest('#pileBrowser .pb-card');
      if(overCard && overCard!==el) overCard.classList.add('drop-before');
      document.getElementById('hand-panel').classList.toggle('hand-drop-target', isOverHandPanel(ev.clientX, ev.clientY));
      const onBoard = !over || (over.closest('#boardViewport') && !over.closest('.board-overlay'));
      const target = onBoard && !overCard ? findOverlapTarget({id:null}, ev.clientX, ev.clientY) : null;
      if(target) showMergeHighlight(target.id); else clearMergeHighlight();
    }
    function up(ev){
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      clearMarks(); clearMergeHighlight();
      document.getElementById('hand-panel').classList.remove('hand-drop-target');
      if(!ghost) return;
      ghost.remove();
      const pieceId = pileBrowser && pileBrowser.pieceId;
      const p = pieceId && state.pieces.get(pieceId); if(!p) return;
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const overCard = over && over.closest('#pileBrowser .pb-card');
      if(overCard){
        const t = Number(overCard.dataset.idx);
        if(t!==i) moveCardWithinPile(pieceId, i, i < t ? t : t+1); // lands just above (on top of) the card it was dropped on
      } else if(over && over.closest('#pileBrowser')){
        return; // dropped on the panel itself, not on a card — nothing to do
      } else if(isOverHandPanel(ev.clientX, ev.clientY)){
        pileBrowserShrink(); drawTopCard(pieceId, 'hand', i);
      } else if(over && over.closest('#boardViewport')){
        pileBrowserShrink(); placePileCardOnBoard(p, i, ev.clientX, ev.clientY);
      }
      renderPileBrowser();
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
// Pulls card i out of pile p as its own face-up piece at the drop point, then
// lands it exactly like any other dragged card would (merge/tuck/snap), as
// one undoable action.
function placePileCardOnBoard(p, i, clientX, clientY){
  const ctx = beginPeelAsPiece(p, i, clientX, clientY);
  if(!ctx) return;
  if(!ctx.p.faceStates[0]) doAction('FLIP_TOP', {id:ctx.p.id, faceUp:true, cardIndex:0});
  finalizeWholePieceDrop(ctx, {clientX, clientY});
}

/* =========================================================================
   HAND (basic — draw from a stack; reordering comes later)
   ========================================================================= */
