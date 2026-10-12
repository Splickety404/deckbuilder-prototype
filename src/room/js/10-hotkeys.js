/* =========================================================================
   HOTKEY HINT — while hovering a board piece with the mouse (desktop only),
   F flips a card, R rotates it a quarter-turn, D draws it into your hand, and
   P peeks at it privately. For an unsplayed pile (or a single card) that's
   always the pile's own top card / the one card there is; hovering a
   SPLAYED pile, all four instead target specifically whichever card is under
   the cursor right now (see hoveredCardIndex below) — same as picking that
   card's own single-card radial menu action, just via the keyboard.
   Hovering the pile's LABEL specifically (see hoveredLabelId) reuses R/F/S
   for the STACK-wide equivalents instead (Rotate/Flip/Search the whole
   pile) — same actions the label-click radial menu's stack-only items call.
   A small reminder pill tracks
   the piece (and rewords itself for "this card only" — see showHotkeyHint)
   so the keys are discoverable without cluttering the radial menu.
   ========================================================================= */
let hoveredPieceId = null;
// Which card (array index) of a SPLAYED pile the mouse is currently over —
// null whenever that's not a meaningful question (nothing splayed is
// hovered right now). F/R/D (see the keydown handler below) all read this
// to scope themselves to that one card instead of the pile as a whole.
let hoveredCardIndex = null;
function wireCardHoverIndex(cardEl, i){
  cardEl.addEventListener('mouseenter', ()=>{ hoveredCardIndex = i; });
  cardEl.addEventListener('mouseleave', ()=>{ if(hoveredCardIndex===i) hoveredCardIndex = null; });
}
// Which pile's own LABEL (not just the pile in general) the mouse is
// currently over — separate from hoveredPieceId because mouseenter/
// mouseleave don't bubble: entering the label (a child of the piece `el`
// wireHotkeyHint is attached to) never re-fires the piece's own mouseenter,
// so hoveredPieceId alone can't tell "hovering the pile" apart from
// "hovering its label specifically." The keydown handler below checks this
// to scope R/F/S to the whole stack (matching the label-click radial menu —
// see openPieceRadialMenu's stack-only branch) instead of the per-card
// actions those same letters mean everywhere else on the pile.
let hoveredLabelId = null;
function wireStackLabelHover(labelEl, pieceId){
  labelEl.addEventListener('mouseenter', ()=>{ hoveredLabelId = pieceId; refreshStackPerimeter(); });
  labelEl.addEventListener('mouseleave', ()=>{ if(hoveredLabelId===pieceId) hoveredLabelId = null; refreshStackPerimeter(); });
}
function refreshStackPerimeter(){
  // Outlines every card of the pile whose label is hovered (see .stack-hover's
  // CSS). Re-run after each renderBoard, which rebuilds the elements.
  document.querySelectorAll('.piece.stack-hover').forEach(el=>{ if(el.dataset.id!==hoveredLabelId) el.classList.remove('stack-hover'); });
  if(!hoveredLabelId) return;
  const el = document.querySelector(`.piece[data-id="${hoveredLabelId}"]`);
  if(el) el.classList.add('stack-hover');
}
function isTextEntryFocused(){
  const a = document.activeElement;
  if(!a) return false;
  const tag = (a.tagName||'').toLowerCase();
  return tag==='input' || tag==='textarea' || tag==='select' || a.isContentEditable;
}
function wireHotkeyHint(el, pieceId){
  el.addEventListener('mouseenter', ()=>{
    hoveredPieceId = pieceId;
    showHotkeyHint(el);
  });
  el.addEventListener('mouseleave', ()=>{
    if(hoveredPieceId===pieceId) hoveredPieceId = null;
    hideHotkeyHint();
  });
}
function showHotkeyHint(el){
  if(pointerDragging) return; // no reminders while moving things (see pointerDragging)
  const hint = document.getElementById('hotkeyHint');
  const p = state.pieces.get(el.dataset.id);
  // A splayed multi-card pile means F/R/D all target one specific card (see
  // the keydown handler) rather than the pile as a whole — reworded here so
  // the hint actually matches what pressing the key will do.
  const perCard = !!(p && p.splayed && p.cardIds.length>1);
  const isStack = !!(p && p.kind!=='image' && p.cardIds.length>1);
  const keys = (p && p.kind==='image')
    ? { E:'Turn ↺', R:'Turn ↻', W:'Ping' } // an image piece has no card faces to flip, draw, or peek at
    : { F:'Flip', E:'Turn ↺', R:'Turn ↻', D:'Draw', A:'Peek', W:'Ping', ...(isStack ? {S:'Shuffle', Q:'Search'} : {}) };
  hint.innerHTML = keyboardHintHtml(keys, perCard ? 'card' : '');
  // Keep clear of the whole pile INCLUDING its label: a 'down' splay docks
  // its label (which carries the card count) above the anchor card, outside
  // the piece's own box, so placing the hint just above the box used to sit
  // right on top of it.
  const r = el.getBoundingClientRect();
  let avoid = {left:r.left, top:r.top, right:r.right, bottom:r.bottom};
  el.querySelectorAll('.piece-label, .search-alert-badge').forEach(lbl=>{
    const lr = lbl.getBoundingClientRect();
    if(!lr.width && !lr.height) return;
    avoid = {left:Math.min(avoid.left, lr.left), top:Math.min(avoid.top, lr.top), right:Math.max(avoid.right, lr.right), bottom:Math.max(avoid.bottom, lr.bottom)};
  });
  hint.classList.remove('hidden');
  const hintRect = hint.getBoundingClientRect();
  const gap = 8;
  let left = (avoid.left+avoid.right)/2 - hintRect.width/2;
  let top = avoid.top - hintRect.height - gap;
  if(top < 4){
    top = avoid.bottom + gap; // not enough room above — show below instead
    if(top + hintRect.height > window.innerHeight - 4){
      // No room above or below either (a tall pile) — sit beside it instead.
      top = Math.max(4, Math.min(r.top, window.innerHeight - hintRect.height - 4));
      left = avoid.right + gap;
      if(left + hintRect.width > window.innerWidth - 4) left = avoid.left - hintRect.width - gap;
    }
  }
  left = Math.max(4, Math.min(left, window.innerWidth - hintRect.width - 4));
  hint.style.left = left+'px';
  hint.style.top = top+'px';
}
function hideHotkeyHint(){ document.getElementById('hotkeyHint').classList.add('hidden'); }
// A little drawing of the left-hand keys (Q W E R / A S D F): keys that do
// something here light up with their action written on them; the rest stay
// dim, so you can see where each one is. `keys` maps a letter to its action.
function keyboardHintHtml(keys, note){
  const rows = ['QWER', 'ASDF'];
  const keyHtml = (k, label)=> label
    ? `<div class="kb-key on"><b>${k}</b><span>${escapeHtml(label)}</span></div>`
    : `<div class="kb-key"><b>${k}</b></div>`;
  return `<div class="kb">${rows.map((r,i)=>`<div class="kb-row r${i}">${[...r].map(k=>keyHtml(k, keys[k])).join('')}</div>`).join('')}
    ${note ? `<div class="kb-note">Flip, Turn, Draw, Peek:<br>the ${escapeHtml(note)} under the cursor</div>` : ''}</div>`;
}
// Token version: W/S in their spots, and the mouse wheel.
function tokenKeyboardHintHtml(){
  const k = (key, label)=> `<div class="kb-key${label?' on':''}"><b>${key}</b>${label?`<span>${label}</span>`:''}</div>`;
  return `<div class="kb-wrap">
    <div class="kb"><div class="kb-row">${k('Q')}${k('W','+1')}${k('E')}</div><div class="kb-row r1">${k('A')}${k('S','−1')}${k('D')}</div></div>
    <div class="kb-mouse"><svg width="26" height="38" viewBox="0 0 26 38" aria-hidden="true">
      <rect x="1.5" y="1.5" width="23" height="35" rx="11.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/>
      <line x1="13" y1="1.5" x2="13" y2="15" stroke="currentColor" stroke-width="1.2" opacity=".35"/>
      <rect x="10.5" y="6" width="5" height="9" rx="2.5" class="kb-wheel"/></svg><span>Scroll ±1</span></div>
  </div>`;
}
document.addEventListener('keydown', (e)=>{
  if(!hoveredPieceId) return;
  if(activeHandDrag) return;
  if(hoveredTokenId) return; // a token sitting on a card gets its own hotkeys (W/S/arrows) // F flips the card being dragged out of the hand instead — see wireHandCardDrag
  if(isTextEntryFocused()) return;
  if(e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts (copy, reload, …) alone
  const p = state.pieces.get(hoveredPieceId);
  if(!p) return;
  const key = e.key.toLowerCase();
  // Whichever card (if any) is under the cursor right now within a SPLAYED
  // pile — undefined (not just null) so it cleanly falls through to
  // flipTopCard/drawTopCard's own "no cardIndex given" default of the top
  // card, same as rotateCardAt/rotatePiece already does with null.
  const cardIdx = (p.splayed && p.cardIds.length>1 && hoveredCardIndex!=null && hoveredCardIndex<p.cardIds.length) ? hoveredCardIndex : undefined;
  const isStack = p.kind!=='image' && p.cardIds.length>1;
  const rotateDir = key==='r' ? 1 : key==='e' ? -1 : 0;
  // S/Q are always stack-wide, from any card in the stack.
  if(isStack && key==='s'){ e.preventDefault(); shufflePiece(hoveredPieceId); return; }
  if(isStack && key==='q'){ e.preventDefault(); openSearchModal(hoveredPieceId); return; }
  // Hovering the pile's own LABEL (rather than a card face) makes R/E/F
  // stack-wide instead — same actions as the Stack radial menu's Rotate/Flip
  // (see openPieceRadialMenu). Only a multi-card pile has a label to hover.
  if(hoveredLabelId===hoveredPieceId && isStack){
    if(rotateDir){ e.preventDefault(); rotateCardAt(hoveredPieceId, null, rotateDir); return; }
    if(key==='f'){ e.preventDefault(); flipStack(hoveredPieceId); return; }
  }
  if(rotateDir){ e.preventDefault(); rotatePiece(hoveredPieceId, rotateDir); }
  else if(p.kind!=='image' && key==='f'){ e.preventDefault(); flipTopCard(hoveredPieceId, cardIdx); }
  else if(p.kind!=='image' && key==='d'){ e.preventDefault(); drawTopCard(hoveredPieceId, 'hand', cardIdx); }
  // Number keys (top row or keypad): draw that many from the top into your
  // hand (0 = 10) — or, while holding Peek (A), look through that many from
  // the top privately (see openPileBrowser).
  else if(p.kind!=='image' && /^[0-9]$/.test(e.key)){
    e.preventDefault();
    const n = e.key==='0' ? 10 : Number(e.key);
    if(peekHeld) openPileBrowser(hoveredPieceId, n);
    else drawTopCards(hoveredPieceId, n);
  }
  // (A — Peek — is held rather than pressed: see the peek key listeners.)
});
// Holding A shows the hidden face of whatever card you hover (see
// renderHoverPreview); letting go goes back to normal.
document.addEventListener('keydown', (e)=>{
  if(e.key.toLowerCase()!=='a' || e.ctrlKey || e.metaKey || e.altKey || isTextEntryFocused()) return;
  e.preventDefault();
  if(e.repeat || peekHeld) return;
  peekHeld = true; peekedThisHold.clear();
  if(previewTarget){ clearTimeout(hoverTimer); renderHoverPreview(); }
});
function releasePeek(){
  if(!peekHeld) return;
  peekHeld = false;
  if(previewTarget) renderHoverPreview(); else hideHoverPreview();
}
document.addEventListener('keyup', (e)=>{ if(e.key.toLowerCase()==='a') releasePeek(); });
window.addEventListener('blur', releasePeek);
// No previews while dragging anything: the card under a moving drag keeps
// changing, which flickered previews of other cards at the side of the screen.
let pointerDownAt = null;
window.addEventListener('mousedown', (e)=>{ pointerDownAt = {x:e.clientX, y:e.clientY}; }, true);
window.addEventListener('mousemove', (e)=>{
  if(!pointerDownAt || !e.buttons || pointerDragging) return;
  if(Math.hypot(e.clientX-pointerDownAt.x, e.clientY-pointerDownAt.y) >= DRAG_THRESHOLD){ pointerDragging = true; clearTimeout(hoverTimer); hideHoverPreview(); hideHotkeyHint(); }
}, true);
window.addEventListener('mouseup', ()=>{ pointerDownAt = null; pointerDragging = false; }, true);
// Draws the top `n` cards of a pile into your hand in one go (fewer if the
// pile is smaller), as one undoable action.
function drawTopCards(pieceId, n){
  const p = state.pieces.get(pieceId); if(!p || p.kind==='image' || !p.cardIds.length) return;
  n = Math.min(n, p.cardIds.length);
  const keep = p.cardIds.length - n;
  const cardRotations = p.cardRotations || p.cardIds.map(()=>0);
  const original = {cardIds:[...p.cardIds], faceStates:[...p.faceStates], cardRotations:[...cardRotations]};
  const drawn = p.cardIds.slice(keep).reverse(); // top card first
  doAction('DRAW_TOP', { id:pieceId, remainingCardIds:p.cardIds.slice(0,keep), remainingFaceStates:p.faceStates.slice(0,keep),
    remainingCardRotations:cardRotations.slice(0,keep), destination:'hand', count:n });
  state.hand.push(...drawn);
  renderHand();
  syncHandCount();
  setUndo(()=>{
    state.hand.splice(state.hand.length-drawn.length, drawn.length);
    renderHand();
    syncHandCount();
    if(state.pieces.has(pieceId)) doAction('RESTORE_PIECE_CARDS', {id:pieceId, ...original});
    else doAction('PLACE_PIECE', {id:pieceId, x:p.x, y:p.y, cardIds:original.cardIds, faceStates:original.faceStates, cardRotations:original.cardRotations, rotation:p.rotation, label:p.label, owner:p.owner});
  });
}
// Escape clears the current multi-selection — a quick, always-available "never
// mind" independent of hovering anything in particular (unlike the R/F/D/P
// hotkeys above).
document.addEventListener('keydown', (e)=>{
  if(e.key!=='Escape') return;
  if(isTextEntryFocused()) return;
  clearSelection();
  exitZoneEdit();
  closeRadialMenu();
  ['focusMenu','boardMenu','gridMenu','themePopover','tokenMenu','dicePopover'].forEach(id=> document.getElementById(id).classList.add('hidden'));
  closePileBrowser();
});

// True when the cursor is over the BOTTOM THIRD of the target's own top-card
// footprint (always PIECE_W x PIECE_H at the target's x,y, regardless of how
// far a splay visually extends it) — the drop should then insert the dragged
// card(s) underneath the pile instead of on top of it. Deliberately generous
// (a full third, not a thin strip right at the edge) so it's easy to land
// without needing pixel precision.
// POV-based, not board/world-space based: a player drags a card toward the
// BOTTOM OF THEIR OWN SCREEN to mean "add to the bottom of the stack" — they
// don't think about which way the board itself is currently rotated
// (state.viewRotation). So the cursor's offset from the target's center is
// converted from world space into screen-aligned space (the same
// world→screen-aligned convention used elsewhere — rotateVector(worldDx,
// worldDy, -state.viewRotation) — undoes the view's own rotation) before
// checking whether it falls in the bottom third. Since the view only ever
// rotates in exact 90° steps, "screen down" lines up exactly with either the
// target's world Y axis (0°/180°) or its world X axis (90°/270°) — never in
// between — so the correct footprint dimension (PIECE_H or PIECE_W) is
// picked to match.
function shouldInsertBelow(target, worldX, worldY){
  if(!target) return false;
  const cx = target.x + PIECE_W/2, cy = target.y + PIECE_H/2;
  const screenAligned = rotateVector(worldX-cx, worldY-cy, -(state.viewRotation||0));
  const rot = ((state.viewRotation||0) % 360 + 360) % 360;
  const axisSwapped = rot===90 || rot===270;
  const halfDepth = (axisSwapped ? PIECE_W : PIECE_H) / 2;
  return screenAligned.y >= halfDepth/3;
}
// insertIndex is an array position in the TARGET's own cardIds (same
// convention as splayInsertIndex/DRAW_TOP/MERGE_PIECES elsewhere): 0 puts the
// dropped piece's cards underneath everything, target.cardIds.length puts
// them on top, and anything between tucks them into that exact spot in a
// splayed fan. Omit it (or pass null) for the old default of "on top."
// splayInfo, when given, is {dir, spacing} (see singleOverSingleSplayPreview)
// and marks the target as freshly splayed the instant this merge lands — the
// "hover a single card over another single card, nudged into the tuck zone"
// gesture creates the splay and the merge in one atomic synced event, rather
// than two separate ones that could arrive out of order for another player.
// The spacing is floored to SPLAY_MIN so the brand-new fan is never a
// zero-width, effectively-hidden sliver even if the drop landed right at the
// nudge threshold (see SINGLE_STACK_TO_SPLAY_NUDGE's own comment on why that
// threshold is measured in a way that can leave spacing near 0 there).
function mergePieceOntoTarget(sourceId, targetId, insertIndex, splayInfo){
  const source = state.pieces.get(sourceId);
  const target = state.pieces.get(targetId);
  if(!source || !target || source.id===target.id) return;
  const sourceClone = JSON.parse(JSON.stringify(source));
  const targetOldCardIds = [...target.cardIds], targetOldFaceStates = [...target.faceStates];
  const targetOldCardRotations = [...(target.cardRotations || target.cardIds.map(()=>0))];
  const targetOldSplay = {splayed: !!target.splayed, dir: target.splayDir||'right', spacing: target.splaySpacing||36};
  const idx = insertIndex==null ? target.cardIds.length : insertIndex;
  // Each card keeps its own face — nothing here forces a match. Same for
  // rotation: a multi-card source carries its OWN per-card rotations in;
  // a single card (the common case now that peeling/hand-play always land
  // here as a real piece — see beginPeelAsPiece/driveWholePieceDrag) has no
  // cardRotations of its own yet, so its piece-level `rotation` is used instead.
  const cardIds = [...target.cardIds.slice(0,idx), ...source.cardIds, ...target.cardIds.slice(idx)];
  const faceStates = [...target.faceStates.slice(0,idx), ...source.faceStates, ...target.faceStates.slice(idx)];
  const sourceRotations = source.cardIds.map((_,i)=> relCardRotation(target, absCardRotation(source, i))); // each card keeps the angle it's showing — see ROTATION MODEL
  const cardRotations = [...targetOldCardRotations.slice(0,idx), ...sourceRotations, ...targetOldCardRotations.slice(idx)];
  const splay = splayInfo ? { dir: splayInfo.dir, spacing: Math.max(SPLAY_MIN, splayInfo.spacing) } : null;
  doAction('MERGE_PIECES', { intoId: target.id, cardIds, faceStates, cardRotations, removedId: source.id, splay });
  setUndo(()=>{
    doAction('RESTORE_PIECE_CARDS', {id:target.id, cardIds:targetOldCardIds, faceStates:targetOldFaceStates, cardRotations:targetOldCardRotations});
    if(splay) doAction('SET_SPLAY', {id:target.id, splayed:targetOldSplay.splayed, dir:targetOldSplay.dir, spacing:targetOldSplay.spacing});
    doAction('PLACE_PIECE', sourceClone);
  });
}

function shufflePiece(pieceId){
  const p = state.pieces.get(pieceId); if(!p) return;
  const oldCardIds = [...p.cardIds], oldFaceStates = [...p.faceStates], oldCardRotations = [...(p.cardRotations||p.cardIds.map(()=>0))];
  const triples = p.cardIds.map((id,i)=>[id, p.faceStates[i], oldCardRotations[i]]); // shuffle id+face+rotation together — each card's own orientation travels with it
  shuffle(triples);
  doAction('SHUFFLE_PIECE', { id:pieceId, cardIds:triples.map(x=>x[0]), faceStates:triples.map(x=>x[1]), cardRotations:triples.map(x=>x[2]) });
  setUndo(()=> doAction('RESTORE_PIECE_CARDS', {id:pieceId, cardIds:oldCardIds, faceStates:oldFaceStates, cardRotations:oldCardRotations}));
}
// Flips the ENTIRE stack over, the way you'd flip a physical packet of cards
// face-down onto the table: the order reverses (bottom card becomes top) AND
// every individual card's face flips (whatever was showing is now hidden and
// vice versa), since the whole packet rotated 180° along a horizontal axis
// rather than each card flipping independently in place (that's Flip / F).
function flipStack(pieceId){
  const p = state.pieces.get(pieceId); if(!p || !p.cardIds.length) return;
  const oldCardIds = [...p.cardIds], oldFaceStates = [...p.faceStates], oldCardRotations = [...(p.cardRotations||p.cardIds.map(()=>0))];
  const newCardIds = [...p.cardIds].reverse();
  const newFaceStates = [...p.faceStates].reverse().map(f=>!f);
  const newCardRotations = [...oldCardRotations].reverse();
  doAction('FLIP_STACK', { id:pieceId, cardIds:newCardIds, faceStates:newFaceStates, cardRotations:newCardRotations });
  setUndo(()=> doAction('RESTORE_PIECE_CARDS', {id:pieceId, cardIds:oldCardIds, faceStates:oldFaceStates, cardRotations:oldCardRotations}));
}

// Commits a splay change (direction/spacing/on-off) as a real synced+undoable
// action. `old` is the state captured once, when the splay popover was first
// opened, so a whole drag-the-slider session still undoes back to "before I
// touched this," not to whatever the previous slider tick was.
function commitSplay(pieceId, splayed, dir, spacing, old){
  doAction('SET_SPLAY', { id:pieceId, splayed, dir, spacing });
  setUndo(()=> doAction('SET_SPLAY', {id:pieceId, splayed:old.splayed, dir:old.dir, spacing:old.spacing}));
}
// Local-only live preview while dragging the spacing slider — no network
// round-trip per tick, and no undo entry until the slider is released.
function previewSplay(pieceId, splayed, dir, spacing){
  const p = state.pieces.get(pieceId); if(!p) return;
  p.splayed = splayed; p.splayDir = dir; p.splaySpacing = spacing;
  renderBoard();
}
// Spacing is expressed directly in board-space px, spanning the full range a
// player can actually see: SPLAY_MIN is a bare sliver of the card underneath
// (just enough to show it's there), and the max is exactly the card's own
// footprint along the splay axis — at that point the next card's edge lands
// exactly on the previous card's far edge, fully revealed with zero gap and
// zero overlap. Left/right splay maxes out at the card's WIDTH; up/down maxes
// out at its HEIGHT, since that's the axis the pile is actually growing along.
const SPLAY_MIN = 6;
function splayMaxFor(dir){ return (dir==='left'||dir==='right') ? PIECE_W : PIECE_H; }
// A splay ends when the card whose edge you're dragging gets dropped nearly
// on top of the pile's TOP (anchor) card — i.e. when the RAW cursor distance
// from the anchor's own edge (see localAxisOffsetFromAnchor) gets this small,
// not when the resulting PER-CARD spacing does. Those aren't the same thing:
// spacing is raw/depth, so a fixed spacing threshold let a deep card (high
// depth) end the splay while it still visually sat far from the anchor, and
// made a shallow card (low depth) need to get closer than it looked like it
// should. Checking raw directly instead means "drag it back to where the top
// card is" behaves the same regardless of which card in the pile you grabbed.
const SPLAY_UNSPLAY_PROXIMITY = SPLAY_MIN + 4;
// How wide a border strip around an UNSPLAYED pile's own edge counts as
// "grabbing the edge" (see stackEdgeAt) rather than an ordinary peel-drag on
// the card itself. SCREEN px, not board-space — divided by state.view.scale
// at the point of use so the grab zone reads as the same physical size on
// screen at any zoom level, rather than growing/shrinking with it (a fixed
// board-space size made it easier to grab when zoomed in and harder when
// zoomed out, which felt backwards).
const SPLAY_EDGE_ZONE = 20;
// The zone above straddled the edge LINE symmetrically — half of it reaching
// into the card, half reaching past it. That read as sitting on the card's
// INTERIOR rather than its edge, since a grab that far into the card already
// feels like "inside the card" to the eye even though it's technically within
// the zone. So the zone is biased outward: only a small sliver reaches into
// the card face, the rest extends past the true edge line and off the card —
// which is where a resize handle actually feels like it belongs.
const SPLAY_EDGE_INSET = 6; // px of the zone that reach INTO the card (screen px, pre-scale)
// distSigned: positive = this many (screen) px INSIDE the card from the edge
// in question; negative = this many px OUTSIDE/past it. `scale` is state.view.scale,
// same screen-px-to-board-space conversion stackEdgeAt/isOnSplayAdjustEdge/
// isOnAnchorSplayEdge always used.
function withinSplayEdgeZone(distSigned, scale){
  const zoneIn = SPLAY_EDGE_INSET / scale;
  const zoneOut = (SPLAY_EDGE_ZONE - SPLAY_EDGE_INSET) / scale;
  return distSigned <= zoneIn && distSigned >= -zoneOut;
}
// The rotation actually applied to a piece's own CONTAINER element (see
// renderBoard) — just p.rotation, full stop, whether or not the pile is
// splayed. A splayed pile's container rotates around its ANCHOR card's own
// center rather than the container's own (much larger, often off-center)
// box center — see renderBoard's transformOrigin comment — so rotating it
// swings the whole fan around the anchor while the anchor itself stays
// visually planted in place, exactly like spinning a real fanned hand of
// cards around its top card. Individual cards can ALSO carry their own
// separate rotation on top of this (see rotateCardAt/ROTATE_CARD) — CSS
// transforms nest, so a card's own rotStyle transform (set in the splayed-
// pile branch below) composes with this container-level one for free,
// without either needing to know about the other.
function effectivePieceRotation(p){ return p.rotation||0; }
// Undoes both the board's own rotation (state.viewRotation, via clientToWorld)
// and this particular piece's own CONTAINER rotation (effectivePieceRotation —
// always a multiple of 90°, same as the board's, so this is exact, never
// skewed) to get a point in the piece's own unrotated local box: (0,0) at its
// top-left corner, (PIECE_W, PIECE_H) at its bottom-right — i.e. genuinely
// "which part of THIS card, as drawn before any rotation was applied, is the
// cursor over."
// World-space version of the same conversion — for a caller that already has
// a board-space (world) point rather than raw screen coordinates (e.g. a
// dragged piece's own current center, per the "keyed off the dragged piece's
// OWN board position, not the cursor" convention used elsewhere — see
// singleOverSingleSplayPreview).
function localOffsetInPieceFromWorld(p, worldX, worldY){
  const cx = p.x + PIECE_W/2, cy = p.y + PIECE_H/2;
  const rel = rotateVector(worldX-cx, worldY-cy, effectivePieceRotation(p));
  return { x: rel.x + PIECE_W/2, y: rel.y + PIECE_H/2 };
}
function localOffsetInPiece(p, clientX, clientY){
  const world = clientToWorld(clientX, clientY);
  return localOffsetInPieceFromWorld(p, world.x, world.y);
}
// Which edge (if any) of an UNSPLAYED multi-card pile a mousedown landed in —
// null means it landed in the middle, an ordinary peel-drag zone. The live
// zone straddles the edge LINE itself (Math.abs of the signed distance to
// it), extending SPLAY_EDGE_ZONE both into the card and slightly off it —
// grabbing right on, or just off, the physical edge is the natural gesture,
// not just a strip somewhere inside the card face. A corner (close to two
// edges at once) resolves to whichever margin is smaller.
function stackEdgeAt(p, clientX, clientY){
  const local = localOffsetInPiece(p, clientX, clientY);
  const scale = state.view.scale;
  const margins = [
    ['left', local.x],
    ['right', PIECE_W-local.x],
    ['up', local.y],
    ['down', PIECE_H-local.y],
  ];
  let best=null, bestVal=Infinity;
  margins.forEach(([dir,distSigned])=>{
    if(withinSplayEdgeZone(distSigned, scale) && Math.abs(distSigned)<bestVal){ best=dir; bestVal=Math.abs(distSigned); }
  });
  return best;
}
// Whether dragging this pile's `dir` edge — a LOGICAL direction in the
// piece's own unrotated local frame, same as p.splayDir/stackEdgeAt's return
// value — reads as a horizontal or vertical drag ON SCREEN, once this piece's
// own rotation (effectivePieceRotation, now real for splayed piles too — see
// its own comment) and the board's current view rotation are both accounted
// for. Both are always exact multiples of 90°, so the left/right-vs-up/down
// axis either stays put (0°/180°) or swaps outright (90°/270°), never skews
// in between — this is what cursorForSplayEdge and the locked body-cursor
// classes (force-cursor-ew/ns) both key off, so the resize cursor always
// points the way the edge will actually move on screen instead of the way it
// moves in the pile's own unrotated design space.
function splayEdgeIsHorizontalOnScreen(p, dir){
  const total = ((effectivePieceRotation(p) + (state.viewRotation||0)) % 360 + 360) % 360;
  const swapped = total===90 || total===270;
  const horizontalLocal = dir==='left' || dir==='right';
  return horizontalLocal !== swapped;
}
function cursorForSplayEdge(p, dir){ return splayEdgeIsHorizontalOnScreen(p, dir) ? 'ew-resize' : 'ns-resize'; }
function lockSplayEdgeCursor(p, dir){
  document.body.classList.add(splayEdgeIsHorizontalOnScreen(p, dir) ? 'force-cursor-ew' : 'force-cursor-ns');
}
// wireSplayAdjustDrag's anchor-adjust mode drags the ANCHOR directly in WORLD
// space (setting p.x/p.y every tick — see its own onMove), constrained to a
// single axis, same as every other splay-edge drag. Which WORLD axis (and
// which sign along it counts as "further out") that is used to just be
// whichever axis p.splayDir itself named ('right'/'left' -> world x, 'up'/
// 'down' -> world y) — true only while the pile's own rotation was always 0.
// Now that a splayed pile's container can rotate (see effectivePieceRotation),
// the pile's LOCAL splay direction and the WORLD direction it actually points
// on screen can differ: rotating 90°/270° swaps the x/y axis outright (never
// skews, since rotation is always a multiple of 90°) — same reasoning as
// splayEdgeIsHorizontalOnScreen, just producing an axis+sign for direct
// position math instead of a cursor name. rotateVector(v, -rot) is the
// FORWARD local->world rotation (rotateVector(v, rot) is what localOffsetInPiece
// uses to undo it, i.e. world->local, so this is deliberately the negated angle).
function worldAxisForSplayDir(p, dir){
  const lx = dir==='right' ? 1 : dir==='left' ? -1 : 0;
  const ly = dir==='down' ? 1 : dir==='up' ? -1 : 0;
  const w = rotateVector(lx, ly, -effectivePieceRotation(p));
  const wx = Math.round(w.x), wy = Math.round(w.y);
  return wx!==0 ? {axis:'x', sign:wx} : {axis:'y', sign:wy};
}
// The spacing value that puts the GRABBED card's own OUTER (far-from-anchor)
// edge — the exact edge isOnSplayAdjustEdge/stackEdgeAt check for a grab —
// precisely under the cursor's CURRENT position, computed fresh each tick
// from where the cursor actually is right now rather than a delta piled up
// since the drag started. That's what keeps the grabbed edge glued to the
// cursor throughout the drag (a pure delta only tracks relative motion, so
// unless the grab happened to land exactly on the edge line, the edge would
// forever sit offset from the cursor by however far off-edge the grab was),
// and it's also why a splay never "jumps" the instant a drag begins — the
// very first tick already reflects the exact spacing implied by the actual
// grab point, instead of snapping to whatever a fresh delta-from-zero would
// give. Used both to begin a brand new splay (wireStackInteraction, which
// passes depth = the LAST/bottom card's depth — cardIds.length-1 — so
// grabbing the pile's edge feels like pulling out the bottom card and
// fanning the whole pile open to wherever your cursor ends up, the far edge
// of the fan tracking the cursor 1:1 rather than needing a much smaller,
// twitchier motion to control one card's worth of spacing) and to adjust an
// existing one (wireSplayAdjustDrag, any card at any depth) — geometrically
// identical in both cases once `depth` is factored in: `raw` is the distance
// from the anchor's own edge to the cursor, i.e. exactly depth*spacing for
// whichever card was actually grabbed, so dividing it back down by that
// card's own depth recovers the single per-card spacing that would put ITS
// edge there — and since every other card's offset is that same spacing
// times ITS OWN depth, the whole fan adjusts together, evenly, no matter
// which card in it you happen to be holding. depth defaults to 1 only as a
// fallback for a caller that doesn't pass one.
// The raw, undivided cursor distance from the anchor's own edge along the
// splay axis — this is what "how close is the dragged card to the top
// card's position" actually means, independent of which card (which depth)
// is being dragged: depth*spacing (a card's own rendered offset from the
// anchor) always equals exactly this raw value by construction (see
// splaySpacingForCursor below), so comparing THIS to a small threshold — not
// the post-division per-card spacing — is what SPLAY_UNSPLAY_PROXIMITY checks
// against.
function localAxisOffsetFromAnchor(p, dir, clientX, clientY){
  const local = localOffsetInPiece(p, clientX, clientY);
  if(dir==='right') return local.x - PIECE_W;
  if(dir==='left') return -local.x;
  if(dir==='down') return local.y - PIECE_H;
  return -local.y; // 'up'
}
function splaySpacingForCursor(p, dir, clientX, clientY, depth){
  const raw = localAxisOffsetFromAnchor(p, dir, clientX, clientY);
  const spacing = raw / (depth||1);
  // Floor is 0, not SPLAY_MIN: SPLAY_MIN is a floor on what a *deliberately
  // splayed* pile should render as (a bare sliver, never fully hidden), but
  // enforcing that same floor on the LIVE per-tick preview meant a deep
  // card's spacing hit that floor and visually froze while raw (the actual
  // cursor-to-anchor distance the unsplay decision is based on — see
  // SPLAY_UNSPLAY_PROXIMITY) was often still well above the auto-unsplay
  // threshold. That's the "positions stop adjusting" bug: the drag looked
  // stuck long before it was actually close enough to collapse. Letting the
  // preview track raw continuously all the way down means it now visually
  // closes up in step with the same distance the drop-time unsplay check
  // uses, right up to the point it actually does unsplay.
  return Math.max(0, Math.min(splayMaxFor(dir), spacing));
}
// How far a single dragged card has to be nudged off a single, unsplayed
// target's own origin before hovering it switches from previewing an
// ordinary "stack on top" merge to previewing a brand-new 2-card splay
// instead — a plain circular radius around the target's origin (its own
// x/y — see PIECE_W/PIECE_H), the same in every direction.
//
// An earlier version compared the nudge against each AXIS's own extent
// separately (a fraction of PIECE_W for a mostly-horizontal nudge, of
// PIECE_H for a mostly-vertical one), specifically to correct for the card
// being taller than it is wide. That correction overshot: it made the two
// axes reach their OWN threshold at the same fraction of nudge, but a
// mostly-vertical nudge still had to travel PIECE_H's share (196px) to get
// there while a mostly-horizontal one only needed PIECE_W's (140px) —
// nudging down still felt like it took distinctly longer than nudging
// sideways the same "amount". A single flat radius, measured once as
// straight-line distance from the origin rather than compared per-axis,
// removes that asymmetry entirely: how far you've dragged is how far
// you've dragged, regardless of which way. 1/4 of the card's SHORTER
// dimension (not the longer one) keeps the gesture reachable without
// having to leave the target's footprint on its narrow axis before it
// engages.
const SINGLE_STACK_TO_SPLAY_RADIUS = Math.min(PIECE_W, PIECE_H) * 0.25;
// Distinct from the tuck-under-a-PILE behavior (shouldInsertBelow/
// splayInsertIndex — those apply once a target is already a multi-card or
// splayed pile): this is specifically for a single dragged card hovering a
// single, unsplayed target card (Seth: "abandon the tucking logic ... for a
// hovered card over a single card ... something different"). Close to the
// target's center previews an ordinary on-top merge (the caller should fall
// back to its usual showMergeHighlight/plain-merge path when this returns
// null); nudged further off previews tucking BEHIND the target along
// whichever local axis (x or y) the nudge favored, snapped to that axis's
// direction — releasing while this shows creates a brand-new 2-card splayed
// pile with the target as the anchor (depth 0, unmoved) and the dragged card
// as its one other, fanned-out card (depth 1) — see mergePieceOntoTarget's
// splayInfo param and renderBoard's splayPreview.newSplay branch. The target
// is always the anchor and the dragged card always the 2nd/last card, so the
// insert is always at index 0 (same convention as splayInsertIndex/
// MERGE_PIECES: 0 = underneath everything, i.e. away from the anchor here).
// pieceCenterX/Y are WORLD coordinates of the DRAGGED piece's own current
// center — same "keyed off the dragged piece's OWN board position, not the
// cursor" convention splayInsertIndex already uses, and for good reason
// here too: findOverlapTarget only recognizes a target while the raw CURSOR
// is literally over that target's small footprint, but the piece being
// dragged can sit well away from the cursor (however far off-center it was
// originally grabbed), so measuring from the piece's own position — not a
// cursor position trapped inside the target's box — is what actually lets
// this nudge gesture be reached at all. (A hand card has no real board
// position yet, so by the same convention its caller passes the cursor's
// own world point, which stands in for the card's would-be center.)
// Returns null when this interaction doesn't apply at all (either side isn't
// a genuine lone single card) or the piece is still in the "stack on top"
// zone; otherwise {dir, spacing} for the tuck/splay preview.
//
// spacing is the RAW center-to-center distance along the fan axis (mag,
// below) — deliberately NOT measured from the threshold (i.e. NOT
// `mag - threshold`, which an earlier version of this used). Two same-size
// cards' center-to-center distance IS exactly the spacing renderBoard's
// offsetFor needs for their edges to align, so using mag directly means the
// card the caller renders at this spacing sits exactly where it's actually
// been dragged to (Seth: "its x axis [the fan axis] should be exactly the
// same, as if it were still completely in the user's grip") — continuous
// with wherever it was rendering a moment ago, still following the cursor
// 1:1, right through the moment this preview first engages. Subtracting the
// threshold instead reset that distance back near 0 the instant `mag`
// crossed it, which visually SNAPPED the card inward by however big the
// threshold was — a sudden jump toward the target the moment you'd nudged
// past it, instead of the fan smoothly opening from wherever you already
// were. The CROSS axis needs no such care: offsetFor already pins it to
// exactly 0 (dead even with the anchor) regardless of spacing, which is the
// "its y position should snap" half of the same request — snapping flush to
// the target is exactly right there, since that's what "joining the splay"
// on that axis means.
// A dragged card only splays with (tucks into, or forms a new splay with)
// a card or pile turned the same way it is — otherwise the fan comes out on
// a diagonal. (Inside a splay, cards can still be turned individually.)
// Anything else just stacks on top as usual. absDeg: the dragged card's own
// angle on the table (a hand card is upright, 0).
function canSplayWith(target, absDeg){
  return !!target && normAngle(target.rotation||0) === normAngle(absDeg||0);
}
function singleOverSingleSplayPreview(target, sourceCardCount, pieceCenterX, pieceCenterY){
  if(!target || target.splayed || target.cardIds.length!==1) return null;
  if(sourceCardCount!==1) return null;
  const local = localOffsetInPieceFromWorld(target, pieceCenterX, pieceCenterY);
  const dx = local.x - PIECE_W/2, dy = local.y - PIECE_H/2;
  if(Math.hypot(dx, dy) < SINGLE_STACK_TO_SPLAY_RADIUS) return null; // still within the origin radius: ordinary stack-on-top
  // Which axis becomes the fan direction is still compared as a FRACTION of
  // each axis's own extent (not raw px), so the taller (Y) axis doesn't
  // dominate just because PIECE_H > PIECE_W — this only decides which way
  // the splay opens, not whether it engages at all (that's the radius
  // check above), so it doesn't have the same overshoot problem.
  const horizontal = Math.abs(dx)/PIECE_W >= Math.abs(dy)/PIECE_H;
  const mag = horizontal ? Math.abs(dx) : Math.abs(dy);
  const dir = horizontal ? (dx>=0 ? 'right':'left') : (dy>=0 ? 'down':'up');
  const spacing = Math.max(0, Math.min(splayMaxFor(dir), mag));
  return { dir, spacing };
}
// An UNSPLAYED multi-card pile: grabbing the thin border strip around its own
// edge (stackEdgeAt) begins a splay in that edge's direction right away —
// dragging further out grows the spacing exactly like wireSplayAdjustDrag
// does for an already-splayed pile's cards (same live preview, same
// snap-back-to-unsplayed-on-release-near-zero), just reached by a different
// gesture since there's no fanned-out pile to grab a specific card of yet.
// Treated as grabbing the LAST (bottom) card specifically — see
// splaySpacingForCursor's own comment — so the cursor is really dragging out
// the far edge of the whole fan, not just the sliver of a 2nd card peeking
// out from under the anchor; this is what makes starting a splay feel like
// fanning the whole pile open by its bottom card, matching how
// wireSplayAdjustDrag already lets you grab ANY card (including the actual
// bottom one) once a pile is already splayed. The direction is
// locked to whichever edge was grabbed at mousedown; changing it means
// dragging back to fully unsplayed first (see wireSplayAdjustDrag's own
// snap-back), then starting a fresh drag from a different edge. Grabbing
// anywhere else peels the top card off, same as always.
function wireStackInteraction(el, p){
  let mode=null, edgeDir=null, old=null, ctx=null;
  // Hover feedback (no drag in progress yet): the cursor previews which edge
  // (if any) a mousedown here would begin a splay from, so the "grab a strip
  // around the edge" affordance is discoverable before you commit to it. Off
  // while a drag on this piece is already under way — el itself may get
  // rebuilt mid-drag (see previewSplay/setSplayPreview), and the locked
  // body-level cursor class takes over at that point anyway.
  el.addEventListener('mousemove', (e)=>{
    if(mode) return;
    const dir = stackEdgeAt(p, e.clientX, e.clientY);
    el.style.cursor = dir ? cursorForSplayEdge(p, dir) : '';
  });
  el.addEventListener('mouseleave', ()=>{ if(!mode) el.style.cursor = ''; });
  wirePressDragClick(el, {
    onDown: (e)=>{
      if(handlePieceSelectionOnDown(p, e)) return false;
      if(p.locked) return false;
      edgeDir = stackEdgeAt(p, e.clientX, e.clientY);
      mode = edgeDir ? 'edge' : 'peel';
      if(mode==='edge'){
        old = { splayed:false, dir:p.splayDir||'right', spacing:p.splaySpacing||36 };
        // Locked for the whole drag (not just while hovering the edge strip)
        // so the cursor doesn't flicker to whatever's under the pointer as
        // you drag further out — see the force-cursor-ew/ns CSS. Rotation-
        // aware (see lockSplayEdgeCursor) so a rotated pile's edge still gets
        // the cursor matching how it actually moves ON SCREEN.
        lockSplayEdgeCursor(p, edgeDir);
      }
    },
    onMove: (dx, dy, ev)=>{
      if(mode==='edge'){
        // depth = the LAST card's own depth (cardIds.length-1), not the default
        // 1 — see splaySpacingForCursor's comment: this makes the cursor track
        // the far edge of the whole fan (as if you'd grabbed the bottom card),
        // which feels far more natural than the old "you're holding the 2nd
        // card" framing, where the same cursor motion produced a much bigger,
        // twitchier swing in per-card spacing on a deep pile.
        const depth = Math.max(1, p.cardIds.length-1);
        const spacing = splaySpacingForCursor(p, edgeDir, ev.clientX, ev.clientY, depth);
        previewSplay(p.id, true, edgeDir, spacing);
        return;
      }
      if(!ctx){ ctx = beginPeelAsPiece(p, p.cardIds.length-1, ev.clientX, ev.clientY); if(!ctx) return; }
      driveWholePieceDrag(ctx, ev.clientX-ctx.pickupClientX, ev.clientY-ctx.pickupClientY, ev);
    },
    // Explicitly the TOP card's own index — not the combined stack menu — so
    // clicking the card's own face always opens the single-card menu, same
    // as picking any other card out of a splay does. The pile-wide menu now
    // lives exclusively behind the label handle (see wireGroupHandleDrag).
    onClick: ()=> flipTopCard(p.id, p.cardIds.length-1),
    onContext: (e)=> openPieceRadialMenu(p.id, e.clientX, e.clientY, p.cardIds.length-1),
    onDrop: (dx, dy, ev)=>{
      document.body.classList.remove('force-cursor-ew', 'force-cursor-ns');
      if(mode==='edge'){
        const p2 = state.pieces.get(p.id); if(!p2) return;
        // Same "let go with the dragged edge back near the top card = cancel
        // back to unsplayed" rule as wireSplayAdjustDrag — here it also covers
        // simply never having dragged far enough out in the first place. See
        // SPLAY_UNSPLAY_PROXIMITY's comment for why this checks the raw cursor
        // distance from the anchor rather than the resulting spacing value.
        const raw = localAxisOffsetFromAnchor(p2, edgeDir, ev.clientX, ev.clientY);
        if(raw <= SPLAY_UNSPLAY_PROXIMITY){
          commitSplay(p.id, false, p2.splayDir, p2.splaySpacing, old);
        } else {
          commitSplay(p.id, true, p2.splayDir, p2.splaySpacing, old);
        }
        return;
      }
      if(!ctx) return;
      finalizeWholePieceDrop(ctx, ev);
      ctx = null;
    },
  });
}
// Splay-card-local geometry for wireSplayAdjustDrag: ANY card in the pile
// except the anchor itself (depth>=1) is in "adjust the fan" territory when
// the grab lands within SPLAY_EDGE_ZONE of the ONE edge matching the pile's
// CURRENT splay direction — everywhere else on that same card (including
// its other three edges) falls through to an ordinary peel, same as any
// other visible card in the pile. `depth` is that card's own distance from
// the anchor in spacing-units (topIndex - cardIndex), so its expected edge
// sits depth*spacing out, not just one spacing-unit like the old
// only-the-2nd-card version — same straddle-the-edge-line zone as
// stackEdgeAt (see its comment): right on, or just off, the physical edge.
function isOnSplayAdjustEdge(p, clientX, clientY, depth){
  const dir = p.splayDir || 'right';
  const spacing = (p.splaySpacing || 36) * (depth||1);
  const pieceLocal = localOffsetInPiece(p, clientX, clientY);
  let left=0, top=0;
  if(dir==='right') left = spacing;
  else if(dir==='left') left = -spacing;
  else if(dir==='down') top = spacing;
  else top = -spacing; // 'up'
  const cardLocal = { x: pieceLocal.x - left, y: pieceLocal.y - top };
  const scale = state.view.scale;
  if(dir==='left') return withinSplayEdgeZone(cardLocal.x, scale);
  if(dir==='right') return withinSplayEdgeZone(PIECE_W - cardLocal.x, scale);
  if(dir==='up') return withinSplayEdgeZone(cardLocal.y, scale);
  return withinSplayEdgeZone(PIECE_H - cardLocal.y, scale); // 'down'
}
// The anchor card's OWN two edges along the splay's locked axis — its LEFT
// and RIGHT edges for a horizontal splay, TOP and BOTTOM for vertical
// (EITHER one; unlike every other card, which only has the one edge that
// matches the current direction, the anchor sits at depth 0 with no offset
// of its own, so both its edges along that axis are exposed and either one
// reads as a natural "fan this open" grab). Straddles each edge LINE itself,
// same zone convention as isOnSplayAdjustEdge/stackEdgeAt.
function isOnAnchorSplayEdge(p, clientX, clientY){
  const dir = p.splayDir || 'right';
  const pieceLocal = localOffsetInPiece(p, clientX, clientY);
  const scale = state.view.scale;
  if(dir==='left' || dir==='right'){
    return withinSplayEdgeZone(pieceLocal.x, scale) || withinSplayEdgeZone(PIECE_W - pieceLocal.x, scale);
  }
  return withinSplayEdgeZone(pieceLocal.y, scale) || withinSplayEdgeZone(PIECE_H - pieceLocal.y, scale);
}
// ANY card in a splayed pile except the anchor itself: grabbing the SAME
// edge that began the splay (matching p.splayDir, see isOnSplayAdjustEdge)
// extends or collapses the existing fan along that one LOCKED axis — it can
// never switch axis or flip direction mid-adjust; to change direction,
// first collapse fully back to unsplayed (drag that edge back within
// SPLAY_UNSPLAY_PROXIMITY of the anchor), then start a fresh splay from a different edge
// via wireStackInteraction. Grabbing anywhere else on this card is an
// ordinary peel — see beginPeelAsPiece/driveWholePieceDrag.
//
// Whichever card you grab, you're really setting THAT card's own distance
// from the anchor's edge — cursor position implies a raw distance
// (splaySpacingForCursor's `raw`), and dividing by this card's own depth
// recovers the single per-card `spacing` that would put its edge exactly
// there. Since every card's own offset is that same spacing times ITS depth
// (see renderBoard's offsetFor), committing that one recovered spacing value
// moves every card in the fan together, keeping the gaps between
// consecutive outer edges equal no matter which card you dragged.
//
// The ANCHOR card (cardIndex === the pile's own top index) is the one
// exception to all of that: it has no depth of its own (always 0), so
// there's no per-card spacing to set relative to itself the way every other
// card has. Grabbing one of ITS two edges (see isOnAnchorSplayEdge) instead
// treats the BOTTOM card (the pile's other extreme — maximum depth) as the
// one that stays put: the anchor tracks the cursor exactly like any other
// whole-piece move (constrained to the locked axis), while `spacing` itself
// is continuously recomputed so that the bottom card's own ABSOLUTE board
// position never moves. Every other card sits at its own depth*spacing away
// from the anchor as always (see renderBoard's offsetFor), so they all
// redistribute evenly between the two ends as the anchor moves — the same
// "grab one end, the other end anchors, everything between fans out evenly"
// feel as grabbing the bottom card directly (isOnSplayAdjustEdge) or
// starting a fresh splay (wireStackInteraction), just from the opposite end.
function wireSplayAdjustDrag(cardEl, p, cardIndex){
  let mode=null, old=null, ctx=null, axis=null, dirSign=null, maxDepth=null, bottomCoord=null;
  const isAnchor = cardIndex === p.cardIds.length-1;
  const depthOf = ()=> Math.max(1, (p.cardIds.length-1) - cardIndex);
  const onEdgeAt = (clientX, clientY)=> isAnchor
    ? isOnAnchorSplayEdge(p, clientX, clientY)
    : isOnSplayAdjustEdge(p, clientX, clientY, depthOf());
  cardEl.addEventListener('mousemove', (e)=>{
    if(mode) return;
    cardEl.style.cursor = onEdgeAt(e.clientX, e.clientY) ? cursorForSplayEdge(p, p.splayDir||'right') : '';
  });
  cardEl.addEventListener('mouseleave', ()=>{ if(!mode) cardEl.style.cursor = ''; });
  wirePressDragClick(cardEl, {
    onDown: (e)=>{
      if(handlePieceSelectionOnDown(p, e)) return false;
      if(p.locked) return false;
      const onEdge = onEdgeAt(e.clientX, e.clientY);
      mode = !onEdge ? 'peel' : (isAnchor ? 'anchor-adjust' : 'adjust');
      if(mode==='anchor-adjust'){
        const dir = p.splayDir || 'right';
        old = { x:p.x, y:p.y, splayed:true, dir, spacing:p.splaySpacing||36 };
        // See worldAxisForSplayDir's own comment — dir names a LOCAL axis,
        // which only equals the WORLD x/y axis while the pile isn't rotated.
        const w = worldAxisForSplayDir(p, dir);
        axis = w.axis; dirSign = w.sign;
        maxDepth = Math.max(1, p.cardIds.length-1);
        // The bottom card's own ABSOLUTE coordinate along the locked axis,
        // captured once, right now, before anything moves — this is the
        // fixed point every subsequent tick solves spacing around.
        bottomCoord = (axis==='x' ? p.x : p.y) + dirSign*maxDepth*old.spacing;
        lockSplayEdgeCursor(p, dir);
      } else if(mode==='adjust'){
        old = { splayed:true, dir:p.splayDir||'right', spacing:p.splaySpacing||36 };
        // Locked for the whole drag, same reasoning as wireStackInteraction's
        // own edge-drag lock — see the force-cursor-ew/ns CSS.
        lockSplayEdgeCursor(p, old.dir);
      }
    },
    onMove: (dx, dy, ev)=>{
      if(mode==='anchor-adjust'){
        const d = screenDeltaToWorldDelta(dx, dy);
        const cursorCoord = (axis==='x' ? old.x+d.x : old.y+d.y); // where the anchor WOULD be, cursor-tracked 1:1
        // Solve for the spacing that puts the bottom card exactly at
        // bottomCoord if the anchor sat at cursorCoord, then clamp it to the
        // same [0, splayMaxFor] range every other adjust-drag uses (see
        // splaySpacingForCursor's own comment on why the floor is 0, not
        // SPLAY_MIN, for a live preview).
        const rawSpacing = dirSign * (bottomCoord - cursorCoord) / maxDepth;
        const spacing = Math.max(0, Math.min(splayMaxFor(old.dir), rawSpacing));
        // Re-derive the anchor's own position FROM the (possibly clamped)
        // spacing, rather than using cursorCoord directly — this is what
        // keeps the bottom card pinned exactly at bottomCoord even once the
        // drag has gone past either end of the clampable range.
        const anchorCoord = bottomCoord - dirSign*maxDepth*spacing;
        if(axis==='x') p.x = anchorCoord; else p.y = anchorCoord;
        previewSplay(p.id, true, old.dir, spacing); // re-renders the whole fan, anchor position included
        return;
      }
      if(mode==='adjust'){
        const dir = old.dir; // locked — never recomputed from the drag vector
        const spacing = splaySpacingForCursor(p, dir, ev.clientX, ev.clientY, depthOf());
        previewSplay(p.id, true, dir, spacing);
        return;
      }
      if(!ctx){ ctx = beginPeelAsPiece(p, cardIndex, ev.clientX, ev.clientY); if(!ctx) return; }
      driveWholePieceDrag(ctx, ev.clientX-ctx.pickupClientX, ev.clientY-ctx.pickupClientY, ev);
    },
    onClick: ()=> flipTopCard(p.id, cardIndex),
    onContext: (e)=> openPieceRadialMenu(p.id, e.clientX, e.clientY, cardIndex), // single-card menu for THIS card specifically
    onDrop: (dx, dy, ev)=>{
      if(mode==='anchor-adjust'){
        document.body.classList.remove('force-cursor-ew', 'force-cursor-ns');
        const p2 = state.pieces.get(p.id); if(!p2) return;
        // Same "dragged back in close = just unsplay" rule as the ordinary
        // adjust-drag below, but mirrored: here the ANCHOR is the card being
        // dragged (it's the pile's own top card, so it can't be compared to
        // itself), and the BOTTOM card is the fixed end instead of the
        // anchor — so this checks the raw, unclamped gap between the
        // dragged anchor and that fixed bottom position, recomputed from the
        // actual drop point rather than the already-clamped p2.x/y (which
        // would reintroduce the same depth-dependent bug SPLAY_UNSPLAY_PROXIMITY
        // fixes elsewhere).
        const d = screenDeltaToWorldDelta(dx, dy);
        const cursorCoord = (axis==='x' ? old.x+d.x : old.y+d.y);
        const rawGap = dirSign * (bottomCoord - cursorCoord);
        const stillSplayed = rawGap > SPLAY_UNSPLAY_PROXIMITY;
        ({x:p2.x, y:p2.y} = snapPos(p2.x, p2.y, PIECE_W, PIECE_H));
        ({x:p2.x, y:p2.y} = applyZoneSnap(p2.x, p2.y, pieceW(p2), pieceH(p2)));
        p2.splayed = stillSplayed;
        postRoomEvent('MOVE_PIECE', {id:p2.id, x:p2.x, y:p2.y});
        postRoomEvent('SET_SPLAY', {id:p2.id, splayed:stillSplayed, dir:p2.splayDir, spacing:p2.splaySpacing});
        renderBoard();
        setUndo(()=>{
          doAction('MOVE_PIECE', {id:p2.id, x:old.x, y:old.y});
          doAction('SET_SPLAY', {id:p2.id, splayed:old.splayed, dir:old.dir, spacing:old.spacing});
        });
        return;
      }
      if(mode==='adjust'){
        document.body.classList.remove('force-cursor-ew', 'force-cursor-ns');
        const p2 = state.pieces.get(p.id); if(!p2) return;
        // Letting go with the dragged card back in close to the anchor's own
        // position would otherwise leave a nearly-closed fan where that same
        // card is almost entirely covered by the top card next time —
        // effectively untouchable. Reading that gesture as "close it" and
        // just unsplaying is both what the player usually means and the only
        // way to keep every card reachable. See SPLAY_UNSPLAY_PROXIMITY's
        // comment for why this is the raw cursor distance from the anchor,
        // not the resulting per-card spacing — the same raw value regardless
        // of which card's edge was actually grabbed.
        const raw = localAxisOffsetFromAnchor(p2, p2.splayDir||'right', ev.clientX, ev.clientY);
        if(raw <= SPLAY_UNSPLAY_PROXIMITY){
          commitSplay(p.id, false, p2.splayDir, p2.splaySpacing, old);
        } else {
          commitSplay(p.id, true, p2.splayDir, p2.splaySpacing, old);
        }
        return;
      }
      if(!ctx) return;
      finalizeWholePieceDrop(ctx, ev);
      ctx = null;
    },
  });
}

const PEEK_ALERT_MS = 2600; // long enough to actually notice, short enough not to linger and clutter the board

// Removes ONE card from a pile — the top card by default, or a specific
// `cardIndex` (any card of a splay) — sending it either into the player's
// private hand (untracked beyond this point) or onto the board as a new
// face-down piece.
function drawTopCard(pieceId, destination, cardIndex){
  const p = state.pieces.get(pieceId); if(!p || !p.cardIds.length) return;
  const idx = cardIndex!=null ? cardIndex : p.cardIds.length-1;
  if(idx<0 || idx>=p.cardIds.length) return;
  const cardId = p.cardIds[idx];
  const drawnAngle = absCardRotation(p, idx); // captured before DRAW_TOP rewrites p — see ROTATION MODEL
  const cardRotations = p.cardRotations || p.cardIds.map(()=>0);
  const remainingCardIds = p.cardIds.filter((_,i)=>i!==idx);
  const remainingFaceStates = p.faceStates.filter((_,i)=>i!==idx);
  const remainingCardRotations = cardRotations.filter((_,i)=>i!==idx);
  const originalCardIds = [...p.cardIds], originalFaceStates = [...p.faceStates], originalCardRotations = [...cardRotations];
  doAction('DRAW_TOP', { id:pieceId, remainingCardIds, remainingFaceStates, remainingCardRotations, destination });
  if(destination==='hand'){
    state.hand.push(cardId);
    renderHand();
    syncHandCount();
    setUndo(()=>{
      state.hand.pop();
      renderHand();
      syncHandCount();
      doAction('RESTORE_PIECE_CARDS', {id:pieceId, cardIds:originalCardIds, faceStates:originalFaceStates, cardRotations:originalCardRotations});
    });
  } else {
    const newId = newPieceId();
    doAction('PLACE_PIECE', { id:newId, x:p.x+30, y:p.y+30, cardIds:[cardId], faceStates:[false], rotation:drawnAngle, owner:state.playerId });
    setUndo(()=>{
      doAction('REMOVE_PIECE', {id:newId});
      doAction('RESTORE_PIECE_CARDS', {id:pieceId, cardIds:originalCardIds, faceStates:originalFaceStates, cardRotations:originalCardRotations});
    });
  }
}

