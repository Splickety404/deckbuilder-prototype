/* =========================================================================
   QUICK CHAT / EMOTE BUBBLES — a short, ephemeral message broadcast via
   CHAT (no board mutation); shows as a fading bubble for everyone and is
   also captured in the full history like any other synced event.
   ========================================================================= */
function showChatBubble(playerName, text, isHistory){
  const log = document.getElementById('chatLog');
  const bubble = document.createElement('div');
  bubble.className = isHistory ? 'chat-bubble history-bubble' : 'chat-bubble';
  bubble.innerHTML = playerName ? `<b>${escapeHtml(playerName)}:</b> ${escapeHtml(text)}` : escapeHtml(text);
  log.appendChild(bubble);
  setTimeout(()=> bubble.remove(), 6000);
  while(log.children.length>8) log.removeChild(log.firstChild);
}
// A synced game action (someone flipped a card, splayed a pile, etc.) — shown
// as a bubble right in the chat feed instead of the old standalone toast, and
// pops the chat panel open so it's never missed even while collapsed. The
// "Show in chat" checkbox in the history flyout can hide just these bubbles
// (see #chatPanel.hide-history) without touching real chat messages or the
// on-demand full history in the flyout itself.
function showHistoryBubble(text){
  showChatBubble(null, text, true);
  setChatCollapsed(false);
}
document.getElementById('chatInput').addEventListener('keydown', (e)=>{
  if(e.key!=='Enter') return;
  const input = e.target;
  const text = input.value.trim();
  if(!text) return;
  doAction('CHAT', {playerName: state.playerName, text});
  input.value = '';
});
// Collapsed state is local-only (never synced) and remembered per-browser, same
// as hand scale / grid settings — floating bubbles still appear either way, so
// collapsing only hides the input row, never incoming chat.
const LS_CHAT_COLLAPSED_KEY = 'eoo_room_chat_collapsed';
function setChatCollapsed(collapsed){
  const panel = document.getElementById('chatPanel');
  panel.classList.toggle('collapsed', collapsed);
  document.getElementById('btnChatToggle').title = collapsed ? 'Expand chat' : 'Collapse chat';
  localStorage.setItem(LS_CHAT_COLLAPSED_KEY, collapsed ? '1' : '0');
}
document.getElementById('btnChatToggle').addEventListener('click', ()=>{
  setChatCollapsed(!document.getElementById('chatPanel').classList.contains('collapsed'));
});
setChatCollapsed(localStorage.getItem(LS_CHAT_COLLAPSED_KEY) === '1');

// Whether game-action bubbles (see showHistoryBubble) show up in the chat feed
// at all — on by default, since "pop the chat open on every game action" is
// the whole point of task; turning it off just filters .history-bubble out of
// #chatLog via CSS, real chat messages are never affected either way.
const LS_SHOW_HISTORY_IN_CHAT_KEY = 'eoo_room_show_history_in_chat';
function setShowHistoryInChat(show){
  document.getElementById('chatPanel').classList.toggle('hide-history', !show);
  document.getElementById('chkShowHistoryInChat').checked = show;
  localStorage.setItem(LS_SHOW_HISTORY_IN_CHAT_KEY, show ? '1' : '0');
}
document.getElementById('chkShowHistoryInChat').addEventListener('change', (e)=> setShowHistoryInChat(e.target.checked));
setShowHistoryInChat(localStorage.getItem(LS_SHOW_HISTORY_IN_CHAT_KEY) !== '0');

function pieceTopFace(p){
  const idx = p.cardIds.length-1;
  const cardId = p.cardIds[idx];
  const card = cardsById.get(cardId);
  const faceUp = p.faceStates[idx];
  return { card, faceUp };
}
// draggable="false" on every card <img> below matters: without it, pressing
// down directly on the image pixels and moving the mouse kicks off the
// BROWSER's own native image drag instead of (or racing with) our custom
// mousedown/mousemove drag handlers — the native drag eats the mousemove
// events our code needs to see, so the gesture silently does nothing (the
// card just shows the browser's translucent drag ghost and snaps back), and
// only a second, cleaner press-and-drag that avoids re-triggering it works.
// Shared by the handful of spots that show a card's own front only (hand,
// drop-ghost, search results) rather than the full face-or-back logic above —
// they only ever show fronts, so a classified card there just needs the same
// "Classified" label swapped in for the image.
function cardFrontInnerHtml(card, size){
  if(card && card._classified) return `<div class="classified-face">🔒 Classified</div>`;
  if(card && card._pending) return `<div class="pending-face">⏳ Access Pending</div>`;
  return card && card._front ? `<img src="${sizedUrl(card._front,size)}" draggable="false">` : '';
}
// Classified is checked before faceUp/back at all — a card you're not
// authorized for stays "Classified" whichever way it's flipped, matching a
// real opponent's hidden card rather than a merely face-down one of yours.
// Pending (registerPendingCards — access check for this card's sheet is
// still in flight) gets the exact same treatment: neither state has real
// front/back data to show yet, so there's nothing faceUp could meaningfully
// pick between.
function cardFaceHtml(cardId, faceUp){
  const card = cardsById.get(cardId);
  if(!card) return `<div class="cardback">?</div>`;
  if(card._classified) return `<div class="cardback classified-face">🔒 Classified</div>`;
  if(card._pending) return `<div class="cardback pending-face">⏳ Access Pending</div>`;
  if(faceUp) return card._front ? `<img src="${sizedUrl(card._front,320)}" draggable="false">` : `<div class="cardback">${escapeHtml((card.name||'?').slice(0,20))}</div>`;
  if(card._doubleSided && card._back) return `<img src="${sizedUrl(card._back,320)}" draggable="false">`;
  const genericBack = cardBackImageUrl(card);
  if(genericBack) return `<img src="${sizedUrl(genericBack,320)}" draggable="false">`;
  return `<div class="cardback">🂠</div>`;
}
function pieceFaceHtml(p){
  const { card, faceUp } = pieceTopFace(p);
  if(!card) return `<div class="cardback">?</div>`;
  if(card._classified) return `<div class="cardback classified-face">🔒 Classified</div>`;
  if(card._pending) return `<div class="cardback pending-face">⏳ Access Pending</div>`;
  if(faceUp) return card._front ? `<img src="${sizedUrl(card._front,320)}" draggable="false">` : `<div class="cardback">${escapeHtml((card.name||'?').slice(0,20))}</div>`;
  if(card._doubleSided && card._back) return `<img src="${sizedUrl(card._back,320)}" draggable="false">`;
  const genericBack = cardBackImageUrl(card);
  if(genericBack) return `<img src="${sizedUrl(genericBack,320)}" draggable="false">`;
  return `<div class="cardback">🂠</div>`;
}
// A stack's card count lives right in its label text now ("Deck (41)", or
// just "(41)" with no custom label) rather than a separate corner badge —
// one element to keep anchored instead of two. A single card (count 1) just
// shows its label as before, with no count (there's nothing to count).
function pieceLabelText(p){
  const count = (p.cardIds||[]).length;
  if(count>1) return (p.label ? escapeHtml(p.label)+' ' : '') + `(${count})`;
  return p.label ? escapeHtml(p.label) : '';
}
function renderBoard(){
  const world = document.getElementById('boardWorld');
  world.innerHTML='';
  renderZones(); // rendered first so they sit visually behind pieces/tokens
  renderBoardTabs();
  state.pieces.forEach(p=>{
    if(!onCurrentTab(p)) return; // another tab's piece
    // A single card currently tucked into a splayed pile's fan as a live
    // preview (see setSplayPreview/driveWholePieceDrag) isn't rendered as its
    // own floating piece at all while that's true — it's shown for real
    // inside the target pile's splay branch below instead, and reappears as
    // a normal piece the instant the drag moves away from the target (which
    // clears the preview and re-renders).
    if(splayPreview && splayPreview.sourceId===p.id) return;
    const el = document.createElement('div');
    el.className='piece' + (p.splayed?' splayed':'') + (state.selectedIds.has(p.id)?' selected':'') + (p.kind==='image'?' image-piece':'')
      + (state.peekAlertIds.has(p.id)?' peek-alert':'') + (state.searchingBy.has(p.id)?' search-alert':'');
    el.style.left = p.x+'px'; el.style.top = p.y+'px';
    const containerRotation = effectivePieceRotation(p);
    el.style.transform = containerRotation ? `rotate(${containerRotation}deg)` : '';
    // .piece's own CSS pivots rotation on its own box center (transform-
    // origin:center center) — correct for an ordinary card, whose box IS
    // just the one card. A SPLAYED pile's box is much bigger (it balloons
    // out to fit the whole fan — see pieceW/pieceH) and, for a 'left'/'up'
    // splay, isn't even centered on the anchor at all (the fan grows
    // backward out of it — see pieceBounds). Rotating around ITS center
    // would make the anchor visibly swing around the screen instead of
    // staying put. Overriding the pivot to the anchor's own center instead —
    // always exactly PIECE_W/2,PIECE_H/2 in the container's local frame,
    // since the anchor always sits at local (0,0)-(PIECE_W,PIECE_H)
    // regardless of splay direction/spacing/card count (see offsetFor's
    // depth-0 case) — keeps the anchor visually fixed while the fan swings
    // around it. This is also exactly the pivot localOffsetInPiece already
    // uses (p.x+PIECE_W/2, p.y+PIECE_H/2), so every splay-edge/peel hit-test
    // already agrees with this rotation with no further changes needed.
    el.style.transformOrigin = (p.splayed && p.cardIds && p.cardIds.length>1) ? `${PIECE_W/2}px ${PIECE_H/2}px` : '';
    // --counter-rotate (read by .piece-label's own transform — see applyRotation's
    // matching comment) normally just cancels the BOARD's rotation, inherited down
    // from #boardRotate. A piece with its own rotation adds a second, per-piece
    // spin on top of that (see the transform line just above) that the inherited
    // value knows nothing about — so every label would still tip over sideways or
    // upside-down whenever ITS card was rotated, even though the board itself
    // wasn't. Overriding the custom property here, combining both rotations, is
    // what keeps the label's TEXT upright and facing the viewer no matter which
    // way this one piece has been spun.
    el.style.setProperty('--counter-rotate', (-(state.viewRotation + containerRotation)) + 'deg');
    el.dataset.id = p.id;
    let topCardOffset = null; // non-null for any multi-card pile — flags that its (always-rendered) piece-label should double as the move-whole-stack handle
    // For placePieceBadges: the anchor (top) card's visible box, the whole
    // fan's box, and the fan direction — all in this element's local coords.
    let badgeAnchor = {x:0, y:0, w:PIECE_W, h:PIECE_H}, badgeFan = null, badgeSplayDir = null;
    // Tokens attached to this card/stack show as chips in its label (a lone
    // card gets a label just for them) — see attachedTokenChipsHtml.
    const attachedChips = attachedTokenChipsHtml(p);
    if(p.kind==='image'){
      // Custom player-uploaded piece — any scale the uploader picked (or later resized
      // to), no card faces/splay/merge/flip/draw, just an image, label, and lock badge.
      el.style.width = pieceW(p)+'px';
      el.style.height = pieceH(p)+'px';
      badgeAnchor = {x:0, y:0, w:pieceW(p), h:pieceH(p)};
      el.innerHTML = `
        <div class="piece-face"><img src="${p.imageUrl||''}" draggable="false"></div>
        ${(p.label || attachedChips) ? `<div class="piece-label">${escapeHtml(p.label||'')}${attachedChips}</div>` : ''}
        ${p.locked ? `<div class="lock-badge">🔒</div>` : ''}
      `;
      wireWholeInteraction(el, p);
    } else if((p.splayed && p.cardIds.length>1) || (splayPreview && splayPreview.targetId===p.id && splayPreview.newSplay && p.cardIds.length===1)){
      // The TOP card is the fixed anchor (depth 0, sits exactly at the piece's own
      // x/y with no offset) and every card beneath it fans out AWAY from that
      // anchor — depth 1 (the "2nd card down") sits one spacing-unit away, depth 2
      // sits two units away, and so on, so each deeper card is proportionally
      // farther out. Direction+spacing can be set by dragging the outer edge of
      // ANY card in the pile (except the anchor itself) — see wireSplayAdjustDrag
      // — not just the 2nd card down; whichever one you grab, its own distance
      // from the anchor is what you're setting, and every other card's distance
      // (that many spacing-units, same direction) follows automatically so the
      // gaps between consecutive outer edges stay equal throughout the fan.
      // A card being dragged in from elsewhere (peeled off another pile, or
      // played from hand) can be previewing a "tuck" into this exact splay —
      // see splayInsertIndex/splayPreview. When it is, depthFor gives every
      // real card one extra depth once it's on the far side of the gap from
      // the anchor, opening up a slot at the previewed position; a single
      // placeholder card (class splay-gap) is added at that slot. Nothing
      // here touches p.cardIds itself — this is a render-only preview, not a
      // real change, committed only on an actual drop (see placePeeledCardToBoard /
      // playHandCardToBoard).
      const preview = (splayPreview && splayPreview.targetId===p.id) ? splayPreview : null;
      // p itself isn't splayed yet when this piece's single card is only
      // PREVIEWING a brand-new splay (see singleOverSingleSplayPreview) — in
      // that case there's no real p.splayDir/p.splaySpacing to fall back on,
      // so the preview's own dir/spacing are used instead. Everything below
      // (n, topIndex, depthFor, offsetFor, etc.) already generalizes to this
      // case for free: n is just p.cardIds.length (1, the anchor-to-be) and
      // the preview always inserts at index 0 (see singleOverSingleSplayPreview's
      // own comment on why the target is always the anchor here).
      const dir = (preview && preview.newSplay) ? preview.newSplay.dir : (p.splayDir || 'right');
      const spacing = (preview && preview.newSplay) ? preview.newSplay.spacing : (p.splaySpacing || 36);
      const horizontal = dir==='left' || dir==='right';
      const n = p.cardIds.length;
      const topIndex = n-1;
      const depthFor = (i)=> !preview ? (topIndex-i) : (i<preview.insertIndex ? (n-i) : (n-i-1));
      const extent = (preview ? n : topIndex)*spacing;
      el.style.width = (PIECE_W + (horizontal?extent:0)) + 'px';
      el.style.height = (PIECE_H + (horizontal?0:extent)) + 'px';
      // A 'left'/'up' splay grows BACKWARD from the anchor (see pieceBounds'
      // own matching comment on this exact asymmetry) — left as just a wider
      // box still anchored at p.x/p.y like a 'right'/'down' splay correctly
      // is, the container's own DECLARED box would balloon out the WRONG
      // way, into empty space on the far side from the real fan, while the
      // actual cards (rendered below with negative offsets) poke out the
      // other way, past the container's own edge. Invisible for the cards
      // themselves — a child can render outside its parent's own box just
      // fine — but wrong for anything that reads the container's own CSS
      // box directly instead of going through pieceBounds, like the plain
      // .selected/.peek-alert/.search-alert outlines (pieceBounds exists
      // specifically because drag-ghost/hit-testing/etc.
      // can't rely on the container's own box either — see its own comment).
      // Shifting the container's own left/top back by this same `extent`,
      // and compensating every child's own offset forward by that same
      // amount below (so each card's ABSOLUTE screen position is
      // unchanged), makes the container's own declared box finally equal
      // its real visual footprint no matter which way the fan grows.
      if(dir==='left') el.style.left = (p.x - extent) + 'px';
      else if(dir==='up') el.style.top = (p.y - extent) + 'px';
      // The rotation pivot (see the transformOrigin set above, before dir/
      // extent were known) assumed the anchor sits at the container's own
      // local (0,0) origin — true for 'right'/'down', and true for 'left'/
      // 'up' before the shift just above, but the shift moves the anchor to
      // local (extent,0)/(0,extent) instead. Re-pinning the pivot there for
      // just those two directions keeps the anchor visually fixed in place
      // while a rotated pile's fan swings around it, exactly as before.
      if(dir==='left' || dir==='up'){
        const pivotX = dir==='left' ? extent + PIECE_W/2 : PIECE_W/2;
        const pivotY = dir==='up' ? extent + PIECE_H/2 : PIECE_H/2;
        el.style.transformOrigin = `${pivotX}px ${pivotY}px`;
      }
      // A card's OWN rotation (see rotatePiece/ROTATE_CARD) rotates it around
      // its own center, same CSS mechanism as everything else in this app —
      // which means a 90°/270° card visually swaps its footprint (renders
      // PIECE_H wide × PIECE_W tall instead of the other way around) without
      // its declared box (still PIECE_W×PIECE_H) or this depth-based slot
      // system changing at all. Left uncompensated, that swap would throw
      // off exactly the thing a fan is supposed to guarantee: that each
      // card's VISIBLE edge sits a consistent `spacing` past the next one
      // in. The (PIECE_W-w)/2 term is exactly how far a rotated card's
      // rendered edge drifts from its declared one — shifting the card's own
      // position by that same amount cancels it back out, so the edge you
      // actually SEE lands at the uniform depth*spacing slot regardless of
      // that card's own rotation. The cross axis needs no such correction:
      // centering the (possibly swapped) rendered box on the piece's own
      // fixed cross-axis center (left/top 0 on that axis) already happens
      // for free, the same way it always did.
      const offsetFor = (depth, rotation)=>{
        const swapped = ((rotation||0) % 180) !== 0;
        let left=0, top=0;
        if(dir==='right'){ const w = swapped?PIECE_H:PIECE_W; left = depth*spacing + (PIECE_W-w)/2; }
        // The +extent here cancels out the container's own -extent left/top
        // shift just above, so each card's ABSOLUTE screen position is
        // exactly what it always was — only where the container's own
        // declared box starts has changed, not where anything actually
        // renders.
        else if(dir==='left'){ const w = swapped?PIECE_H:PIECE_W; left = extent - depth*spacing - (PIECE_W-w)/2; }
        else if(dir==='down'){ const h = swapped?PIECE_W:PIECE_H; top = depth*spacing + (PIECE_H-h)/2; }
        else if(dir==='up'){ const h = swapped?PIECE_W:PIECE_H; top = extent - depth*spacing - (PIECE_H-h)/2; }
        return {left, top};
      };
      // Split into "before" and "after" the tuck slot rather than one
      // straight map, so the DOM order — which is what actually decides
      // paint order for these overlapping absolutely-positioned cards — can
      // put the preview card in between them: cards that end up ABOVE the
      // held card in the fan (its "after" group, painted later) need to sit
      // on top of it, and cards that end up BELOW it (its "before" group)
      // need to sit behind it, exactly as if it had already been inserted.
      // With no preview, everything just goes in the "before" bucket, in
      // original order — same result as a plain unsplit map.
      const cardRotations = p.cardRotations || p.cardIds.map(()=>0);
      const beforeCards = [], afterCards = [];
      p.cardIds.forEach((cid,i)=>{
        const rot = cardRotations[i]||0;
        const {left, top} = offsetFor(depthFor(i), rot);
        // NOTE: deliberately NOT also class="piece-face" — .piece .piece-face{position:relative}
        // is a more specific selector than plain .splay-card{position:absolute}, so a card
        // carrying both classes loses its absolute positioning and falls into normal
        // document flow instead (each card stacking below the last, ~140-190px down per
        // card) while its left/top splay offset still applies as a RELATIVE shift on top of
        // that — the two together is exactly the "cards fan out in a diagonal staircase and
        // the anchor card ends up thousands of pixels off-screen" bug. .splay-card already
        // declares its own width/height/border/background identical to .piece-face, so it
        // never needed that class in the first place.
        // Every card — the anchor included — has at least one live,
        // draggable edge now (see wireSplayAdjustDrag/isOnAnchorSplayEdge);
        // the anchor gets both edges along the axis instead of the one every
        // other card is limited to. No visual decoration on any of it — see
        // the CSS comment on .splay-card — just the cursor change on hover.
        const rotStyle = rot ? `transform:rotate(${rot}deg);` : '';
        const cardHtml = `<div class="splay-card" data-i="${i}" style="left:${left}px;top:${top}px;${rotStyle}">${cardFaceHtml(cid, p.faceStates[i])}</div>`;
        if(preview && i>=preview.insertIndex) afterCards.push(cardHtml); else beforeCards.push(cardHtml);
      });
      let html = beforeCards.join('');
      if(preview){
        const previewRot = preview.cardId ? (preview.rotation||0) : 0;
        const {left, top} = offsetFor(n-preview.insertIndex, previewRot);
        // When the preview carries an actual card (a single dragged card —
        // see setSplayPreview/driveWholePieceDrag), show that card's own face
        // — at its own current rotation, so nothing visually jumps the
        // instant it's actually dropped — sitting right in its would-land
        // slot instead of a blank placeholder — the dragged piece itself is
        // skipped from its own normal rendering while this is showing (see
        // the top of renderBoard). A multi-card whole-pile drag has no
        // single face to show, so it still falls back to the plain dashed
        // placeholder.
        const cls = 'splay-card splay-gap' + (preview.cardId ? ' splay-gap-real' : '');
        const rotStyle = previewRot ? `transform:rotate(${previewRot}deg);` : '';
        const inner = preview.cardId ? cardFaceHtml(preview.cardId, preview.faceUp) : '';
        html += `<div class="${cls}" style="left:${left}px;top:${top}px;${rotStyle}">${inner}</div>`;
      }
      html += afterCards.join('');
      // The anchor card's VISIBLE box (a 90°-turned anchor is wider than tall)
      // and the whole fan's box — where placePieceBadges hangs the label from.
      {
        const anchorRot = cardRotations[topIndex]||0;
        const off = offsetFor(depthFor(topIndex), anchorRot);
        const cx = off.left + PIECE_W/2, cy = off.top + PIECE_H/2;
        const turned = (anchorRot % 180) !== 0;
        const w = turned ? PIECE_H : PIECE_W, h = turned ? PIECE_W : PIECE_H;
        badgeAnchor = {x:cx-w/2, y:cy-h/2, w, h};
        badgeFan = {x:0, y:0, w:PIECE_W + (horizontal?extent:0), h:PIECE_H + (horizontal?0:extent)};
        badgeSplayDir = dir;
      }
      el.innerHTML = html + `<div class="piece-label stack-handle" title="Drag to move the whole stack">${pieceLabelText(p)}${attachedChips}</div>`;
      topCardOffset = {left:0, top:0}; // the top card is always the anchor now
      [...el.querySelectorAll('.splay-card:not(.splay-gap)')].forEach(cardEl=>{
        const i = Number(cardEl.dataset.i);
        wireHoverPreview(cardEl, ()=>({card:cardsById.get(p.cardIds[i]), faceUp:p.faceStates[i]}), {pieceId:p.id, cardIndex:i});
        // Tracks which card of THIS splay is under the mouse (see
        // hoveredCardIndex/rotatePiece) so R rotates just that one card
        // instead of the whole pile.
        wireCardHoverIndex(cardEl, i);
        cardEl.title = i===topIndex
          ? 'Drag either highlighted edge to set spacing; drag anywhere else on this card to peel it off'
          : 'Drag the highlighted edge to set that card\'s spacing; drag anywhere else on this card to peel it off';
        wireSplayAdjustDrag(cardEl, p, i); // this card's own edge (both edges, for the anchor) sets the fan's spacing — see above
      });
      wirePeelInteraction(el, p, topIndex); // fallback for the (rare) spots inside el not covered by any specific card, e.g. between fanned cards
    } else {
      el.style.width = PIECE_W+'px';
      el.style.height = PIECE_H+'px';
      const isStack = p.cardIds.length>1;
      // The top card's own angle within the pile (see ROTATION MODEL) — only
      // ever nonzero for a multi-card pile, e.g. one rotated while splayed.
      const topRot = (p.cardRotations||[])[p.cardIds.length-1]||0;
      if(topRot % 180) badgeAnchor = {x:(PIECE_W-PIECE_H)/2, y:(PIECE_H-PIECE_W)/2, w:PIECE_H, h:PIECE_W};
      el.innerHTML = `
        <div class="piece-face"${topRot ? ` style="transform:rotate(${topRot}deg)"` : ''}>${pieceFaceHtml(p)}</div>
        ${isStack
          ? `<div class="piece-label stack-handle" title="Drag to move the whole stack">${pieceLabelText(p)}${attachedChips}</div>`
          : ((p.label || attachedChips) ? `<div class="piece-label">${escapeHtml(p.label||'')}${attachedChips}</div>` : '')}
        ${p.locked ? `<div class="lock-badge">🔒</div>` : ''}
      `;
      wireHoverPreview(el, ()=>pieceTopFace(p), {pieceId:p.id, cardIndex:p.cardIds.length-1});
      if(isStack){
        topCardOffset = {left:0, top:0};
        wireStackInteraction(el, p); // edge = begin a splay; anywhere else = peel the top card off, same as always
      } else {
        wireWholeInteraction(el, p); // nothing to peel — a single card just moves as a whole
      }
    }
    if(topCardOffset){
      // Multi-card pile: the label rendered above doubles as the always-visible
      // "move whole stack" drag handle, so it's never a separate element sitting
      // on top of (and covering) the label anymore — see the CSS comment on
      // .piece-label.stack-handle.
      const labelHandle = el.querySelector('.piece-label.stack-handle');
      if(labelHandle){
        wireGroupHandleDrag(labelHandle, p);
        wireStackLabelHover(labelHandle, p.id); // see hoveredLabelId — scopes the R/F/S hotkeys to the whole pile
      }
    }
    wireHotkeyHint(el, p.id);
    // Anti-cheat visibility: applied uniformly here (rather than inside any one
    // of the branches above) so it shows up on an image piece, a plain card, or
    // a splayed pile alike. peek-alert/search-alert (CSS) give the outline;
    // this badge names WHO, so "someone's looking at this pile" is unambiguous.
    if(state.searchingBy.has(p.id)){
      const badge = document.createElement('div');
      badge.className = 'search-alert-badge';
      badge.textContent = state.searchingBy.get(p.id);
      el.appendChild(badge);
    }
    el.querySelectorAll('.label-token').forEach(chip=>{ const t = state.tokens.get(chip.dataset.id); if(t) wireLabelTokenChip(chip, t); });
    placePieceBadges(el, p, badgeAnchor, badgeFan || badgeAnchor, badgeSplayDir);
    applyPingHighlight(el, p.id); // survives this rebuild — see pingHighlights
    world.appendChild(el);
    if(hoveredPieceId===p.id) showHotkeyHint(el); // re-anchor the hint to the freshly-rebuilt element
  });
  if(hoveredPieceId && !state.pieces.has(hoveredPieceId)){ hoveredPieceId = null; hoveredCardIndex = null; hideHotkeyHint(); }
  if(hoveredLabelId && !state.pieces.has(hoveredLabelId)) hoveredLabelId = null;
  refreshStackPerimeter();
  renderTokens();
  renderPlayerCounters();
  document.getElementById('boardEmptyHint').classList.toggle('hidden', [...state.pieces.values()].some(onCurrentTab) || [...state.tokens.values()].some(onCurrentTab));
  if(pileBrowser) renderPileBrowser(); // keep an open search/peek panel in step with its pile
  // Other players' cursors live in #boardWorld too — put them back after the wipe above.
  if(presenceCursors) presenceCursors.forEach(c=>{ if(!c.isConnected) world.appendChild(c); });
}
function boardBounds(){
  const here = o=> onCurrentTab(o);
  if(![...state.pieces.values()].some(here) && ![...state.tokens.values()].some(here) && ![...state.zones.values()].some(here)) return {minX:-400,minY:-400,maxX:400,maxY:400};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  state.pieces.forEach(p=>{
    if(!here(p)) return;
    const b = pieceBounds(p);
    minX=Math.min(minX,b.x); minY=Math.min(minY,b.y);
    maxX=Math.max(maxX,b.x+b.w); maxY=Math.max(maxY,b.y+b.h);
  });
  state.tokens.forEach(t=>{
    if(t.attachedTo || !here(t)) return; // attached: covered by its host piece's own bounds
    minX=Math.min(minX,t.x); minY=Math.min(minY,t.y);
    maxX=Math.max(maxX,t.x+44); maxY=Math.max(maxY,t.y+44);
  });
  state.zones.forEach(z=>{
    if(!here(z)) return;
    minX=Math.min(minX,z.x); minY=Math.min(minY,z.y);
    maxX=Math.max(maxX,z.x+z.w); maxY=Math.max(maxY,z.y+z.h);
  });
  const pad=300;
  return {minX:minX-pad, minY:minY-pad, maxX:maxX+pad, maxY:maxY+pad};
}
function fitAll(){
  const vp = document.getElementById('boardViewport');
  const b = boardBounds();
  const w = b.maxX-b.minX, h = b.maxY-b.minY;
  // Turned 90°/270°, the board's width runs up the screen — fit it against the
  // viewport's height instead (centering below is unaffected: the view spins
  // around the viewport's own center).
  const sideways = ((state.viewRotation||0) % 180) !== 0;
  const fitW = sideways ? h : w, fitH = sideways ? w : h;
  const scale = Math.min(vp.clientWidth/fitW, vp.clientHeight/fitH, 1); // never zoom IN past 1:1 just because the board is small
  state.view.scale = Math.max(0.08, scale);
  state.view.x = -b.minX*state.view.scale + (vp.clientWidth - w*state.view.scale)/2;
  state.view.y = -b.minY*state.view.scale + (vp.clientHeight - h*state.view.scale)/2;
  applyView();
}
document.getElementById('btnZoomFit').addEventListener('click', fitAll);

/* Zoom (wheel — panning is right-drag, see BOARD MOUSE CONTROLS), clamped between a "see everything"
   minimum and a "one card fills the screen" maximum. */
// Scrolling over a token changes its count (up = +1) instead of zooming —
// same quiet live sync + one summary as the W/S hotkeys (see hotkeyAdjustToken).
// Deltas are accumulated so a trackpad's stream of tiny scroll events steps
// at a sane rate; one mouse-wheel notch is one step.
let tokenWheelAcc = 0, tokenWheelId = null;
// Scroll over any card (board or hand) grows/shrinks the hover preview, 10%
// per notch, remembered in this browser. Shows the preview right away.
let previewWheelAcc = 0;
function wheelPreviewScale(e){
  previewWheelAcc += e.deltaMode===1 ? e.deltaY*33 : e.deltaY;
  if(Math.abs(previewWheelAcc) < 50) return;
  const step = previewWheelAcc < 0 ? 0.1 : -0.1;
  previewWheelAcc = 0;
  previewScale = Math.round(Math.max(0.5, Math.min(2.5, previewScale + step))*10)/10;
  try{ localStorage.setItem(LS_PREVIEW_SCALE_KEY, String(previewScale)); }catch(err){}
  clearTimeout(hoverTimer);
  renderHoverPreview();
}
const TOKEN_WHEEL_STEP = 50;
document.getElementById('boardViewport').addEventListener('wheel', (e)=>{
  const tokenEl = e.target.closest && e.target.closest('.token, .label-token');
  if(!tokenEl){
    // Over a card: resize its preview instead of zooming the board.
    if(e.target.closest && e.target.closest('.piece')){ e.preventDefault(); e.stopImmediatePropagation(); wheelPreviewScale(e); }
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation(); // don't also zoom
  const id = tokenEl.dataset.id;
  if(id!==tokenWheelId){ tokenWheelId = id; tokenWheelAcc = 0; }
  tokenWheelAcc += e.deltaMode===1 ? e.deltaY*33 : e.deltaY; // line-based wheels report ~3 per notch
  if(Math.abs(tokenWheelAcc) < TOKEN_WHEEL_STEP) return;
  const delta = tokenWheelAcc < 0 ? 1 : -1;
  tokenWheelAcc = 0;
  hoveredTokenId = id;
  hotkeyAdjustToken(id, delta);
}, {passive:false});
document.getElementById('boardViewport').addEventListener('wheel', (e)=>{
  e.preventDefault();
  const vp = document.getElementById('boardViewport');
  const rect = vp.getBoundingClientRect();
  // The point under the cursor, in #boardRotate's own (unrotated) local frame — see
  // clientToWorld's comment. Re-derived here (rather than just calling clientToWorld
  // for world coords) because re-anchoring the view after zooming needs this
  // intermediate "rotation undone but pan/zoom not yet undone" point too, not just
  // the final world coords.
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  const rel = rotateVector(e.clientX-cx, e.clientY-cy, state.viewRotation);
  const mx = (cx+rel.x)-rect.left, my = (cy+rel.y)-rect.top;
  const worldX = (mx - state.view.x)/state.view.scale;
  const worldY = (my - state.view.y)/state.view.scale;
  const maxScale = Math.min(vp.clientWidth/PIECE_W, vp.clientHeight/PIECE_H); // one card fills the screen
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  state.view.scale = Math.min(maxScale, Math.max(0.05, state.view.scale*factor));
  state.view.x = mx - worldX*state.view.scale;
  state.view.y = my - worldY*state.view.scale;
  applyView();
}, {passive:false});

// Rubber-band box-select: a left-drag over empty board space (see BOARD
// MOUSE CONTROLS above, which is what actually triggers this) draws this
// box; on release, every UNLOCKED piece and every UNATTACHED token whose
// footprint touches even a little of it gets selected (a stack, a splayed
// stack, a single card, a token — never a zone, and never anything locked).
// `additive` (shift held) unions onto whatever was already selected instead
// of replacing it — the usual "shift adds" convention. A live "N selected"
// pill rides along next to the cursor the whole time, and every item that's
// newly swept in gets a little one-shot bounce the instant the box closes
// (see selectPop) — both purely for feel.
function beginBoxSelect(startClientX, startClientY, additive){
  const start = clientToWorld(startClientX, startClientY);
  const box = document.createElement('div');
  box.id = 'selectionBox';
  document.getElementById('boardWorld').appendChild(box);
  const countEl = document.createElement('div');
  countEl.id = 'selectionCount';
  document.body.appendChild(countEl);
  function rectFrom(ev){
    const cur = clientToWorld(ev.clientX, ev.clientY);
    return { x:Math.min(start.x,cur.x), y:Math.min(start.y,cur.y), w:Math.abs(cur.x-start.x), h:Math.abs(cur.y-start.y) };
  }
  function countInRect(r){
    let n = additive ? totalSelectedCount() : 0;
    state.pieces.forEach(p=>{
      if(p.locked || !onCurrentTab(p)) return;
      const b = pieceBounds(p); // a left/up-splayed pile's true footprint isn't anchored at p.x/p.y — see pieceBounds
      if(b.x < r.x+r.w && b.x+b.w > r.x && b.y < r.y+r.h && b.y+b.h > r.y && !(additive && state.selectedIds.has(p.id))) n++;
    });
    state.tokens.forEach(t=>{
      if(t.attachedTo || !onCurrentTab(t)) return;
      const size = tokenSize(t);
      if(t.x < r.x+r.w && t.x+size > r.x && t.y < r.y+r.h && t.y+size > r.y && !(additive && state.selectedTokenIds.has(t.id))) n++;
    });
    return n;
  }
  function onMove(ev){
    const r = rectFrom(ev);
    box.style.left=r.x+'px'; box.style.top=r.y+'px'; box.style.width=r.w+'px'; box.style.height=r.h+'px';
    const n = countInRect(r);
    countEl.innerHTML = `${n===1 ? '1 selected' : `${n} selected`}<span class="zone-tip">Right-click: make this a zone</span>`;
    countEl.style.left = (ev.clientX+18)+'px';
    countEl.style.top = (ev.clientY+18)+'px';
  }
  // Right-click while the box is still being dragged: turn the box into a new
  // zone instead of selecting anything (capture phase on window, so the
  // board's own right-click handling — pan/menu — never sees this press).
  function onRightDown(ev){
    if(ev.button!==2) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    teardown();
    addZoneFromRect(rectFrom(ev), ev.clientX, ev.clientY);
  }
  function teardown(){
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('mousedown', onRightDown, true);
    box.remove();
    countEl.remove();
  }
  function onUp(ev){
    if(ev.button!==0) return;
    teardown();
    const r = rectFrom(ev);
    const ids = additive ? new Set(state.selectedIds) : new Set();
    const tokenIds = additive ? new Set(state.selectedTokenIds) : new Set();
    const newPieceIds = [], newTokenIds = [];
    state.pieces.forEach(p=>{
      if(p.locked || !onCurrentTab(p)) return; // never selectable — see the feature comment above
      const b = pieceBounds(p); // a left/up-splayed pile's true footprint isn't anchored at p.x/p.y — see pieceBounds
      if(b.x < r.x+r.w && b.x+b.w > r.x && b.y < r.y+r.h && b.y+b.h > r.y){
        if(!ids.has(p.id)) newPieceIds.push(p.id);
        ids.add(p.id);
      }
    });
    state.tokens.forEach(t=>{
      if(t.attachedTo || !onCurrentTab(t)) return; // rides its host piece — not independently selectable
      const size = tokenSize(t);
      if(t.x < r.x+r.w && t.x+size > r.x && t.y < r.y+r.h && t.y+size > r.y){
        if(!tokenIds.has(t.id)) newTokenIds.push(t.id);
        tokenIds.add(t.id);
      }
    });
    state.selectedIds = ids;
    state.selectedTokenIds = tokenIds;
    renderBoard();
    selectPop(newPieceIds, newTokenIds);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('mousedown', onRightDown, true);
}

// Multi-select — shift-click toggles a piece/token in/out of state.selectedIds/
// selectedTokenIds (local only, never synced); dragging any piece or token
// that's part of a >1-item selection moves the whole mixed group together
// instead of just itself (see beginGroupDrag). Zones are never selectable
// this way, and neither is a locked piece (a locked token doesn't exist —
// see PLACE_TOKEN — so every token is always eligible).
function totalSelectedCount(){ return state.selectedIds.size + state.selectedTokenIds.size; }
function toggleSelectPiece(pieceId){
  if(state.selectedIds.has(pieceId)) state.selectedIds.delete(pieceId);
  else { state.selectedIds.add(pieceId); selectPop([pieceId], []); }
  renderBoard();
}
function toggleSelectToken(tokenId){
  if(state.selectedTokenIds.has(tokenId)) state.selectedTokenIds.delete(tokenId);
  else { state.selectedTokenIds.add(tokenId); selectPop([], [tokenId]); }
  renderBoard();
}
function clearSelection(){
  if(!state.selectedIds.size && !state.selectedTokenIds.size) return;
  state.selectedIds.clear();
  state.selectedTokenIds.clear();
  renderBoard();
}
// Shared front half of every piece-drag onDown: shift toggles just this one
// piece in/out of the selection (vetoing the rest of the gesture — the press
// was "select", not "move"); already being part of a >1-item mixed selection
// hands off to the whole-group drag instead; otherwise, if some OTHER
// selection is active, a plain click/drag-start on a piece that ISN'T in it
// deselects everything first — "clicking on any piece not in the selection
// deselects" — before falling through to that piece's own normal one-piece
// interaction. Returns true when the caller should veto the gesture (return
// false from its own onDown), false to keep going.
function handlePieceSelectionOnDown(p, e){
  if(e.shiftKey){ toggleSelectPiece(p.id); return true; }
  if(state.selectedIds.has(p.id) && totalSelectedCount()>1){ beginGroupDrag({kind:'piece', id:p.id}, e); return true; }
  if((state.selectedIds.size||state.selectedTokenIds.size) && !state.selectedIds.has(p.id)) clearSelection();
  return false;
}
// Token equivalent of handlePieceSelectionOnDown — see its comment.
function handleTokenSelectionOnDown(t, e){
  if(e.shiftKey){ toggleSelectToken(t.id); return true; }
  if(state.selectedTokenIds.has(t.id) && totalSelectedCount()>1){ beginGroupDrag({kind:'token', id:t.id}, e); return true; }
  if((state.selectedIds.size||state.selectedTokenIds.size) && !state.selectedTokenIds.has(t.id)) clearSelection();
  return false;
}
// A little one-shot bounce (see .select-pop) for whichever pieces/tokens just
// NEWLY joined the selection — called right as they're added, before the
// renderBoard() that follows has necessarily run yet, so it waits a tick for
// the (freshly rebuilt) elements to actually exist in the DOM.
function selectPop(pieceIds, tokenIds){
  if(!pieceIds.length && !tokenIds.length) return;
  requestAnimationFrame(()=>{
    pieceIds.forEach(id=>{
      const el = document.querySelector(`.piece[data-id="${id}"]`);
      if(el) el.classList.add('select-pop');
    });
    tokenIds.forEach(id=>{
      const el = document.querySelector(`.token[data-id="${id}"]`);
      if(el) el.classList.add('select-pop');
    });
  });
}
/* =========================================================================
   PIECE INTERACTION MODEL
   A plain left-click/tap on a card flips it; a right-click (or touch
   long-press) opens its radial menu — see BOARD MOUSE CONTROLS. A
   click-and-DRAG moves something instead — exactly what depends on where
   you grabbed it:
     - Grab a card face directly (the top card, or, on a splayed pile, any
       specific card in the fan) → that ONE card peels off into a new piece
       that follows the cursor and lands where you release it.
     - Grab the small circular handle that appears under the top card on
       hover → the WHOLE pile moves together, same as dragging always did
       before this pile had more than one card in it.
     - A single-card pile or a custom image piece has nothing to "peel" —
       dragging it anywhere just moves the whole thing, like the handle does.
   All three share one press/drag/click primitive (wirePressDragClick) so the
   threshold-based click-vs-drag decision and the ghost/silhouette preview
   logic only exist once.
   ========================================================================= */
const DRAG_THRESHOLD = 5; // px of screen movement before a press counts as a drag rather than a click
// Attaches to `el`: fires onDown at mousedown (returning false vetoes the
// whole gesture — e.g. it already handled a shift-click itself); then either
// onClick (pointer never moved past the threshold) or onMove repeatedly plus
// onDrop once (real dragging happened), with onDrop given the total
// screen-space delta and the raw mouseup event for its client coordinates.
// onContext (optional) is what a right-click on `el` does — it isn't wired
// here directly; it's stored as el._ctx for dispatchContextClick (see BOARD
// MOUSE CONTROLS) to find, since right-drag has to pan no matter where it
// starts.
function wirePressDragClick(el, {onDown, onMove, onClick, onDrop, onContext, threshold=DRAG_THRESHOLD}){
  if(onContext) el._ctx = onContext;
  // The mousedown/mouseup pair above is what actually decides click-vs-drag and
  // calls onClick/onDrop — but the BROWSER also fires its own native 'click'
  // event afterward (since mousedown and mouseup both landed on this element),
  // which bubbles to document where various "click outside me = close" popover
  // listeners live (radialMenu, tokenMenu, zonePopover, …). Left alone, that
  // native click reaches document AFTER onClick has already opened a menu and
  // immediately closes the very menu it just opened. Swallowing it here (not
  // on mousedown, which is a different event) is what actually prevents that.
  el.addEventListener('click', (e)=> e.stopPropagation());
  el.addEventListener('mousedown', (e)=>{
    if(e.button!==0) return; // left-click only
    if(onDown && onDown(e)===false) return;
    e.stopPropagation();
    const startClientX=e.clientX, startClientY=e.clientY;
    let moved=false;
    function move(ev){
      const dx=ev.clientX-startClientX, dy=ev.clientY-startClientY;
      if(!moved){
        if(Math.hypot(dx,dy) < threshold) return;
        moved = true;
      }
      if(onMove) onMove(dx, dy, ev);
    }
    function up(ev){
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if(!moved){ if(onClick) onClick(e); return; }
      const dx=ev.clientX-startClientX, dy=ev.clientY-startClientY;
      if(onDrop) onDrop(dx, dy, ev);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
// Faint outline of where a dragged piece/token will actually land — grid- and
// zone-snapped exactly like the drop itself, so it's a true preview rather
// than just following the cursor. Lives inside #boardWorld so it automatically
// pans/zooms/rotates with the rest of the board; created fresh per drag and
// torn down on drop (or if the board gets rebuilt out from under it mid-drag,
// e.g. by a remote event — updateDragGhost simply no-ops once it's detached).
function createDragGhost(){
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  document.getElementById('boardWorld').appendChild(ghost);
  return ghost;
}
function updateDragGhost(ghost, x, y, w, h, rotation){
  if(!ghost || !ghost.isConnected) return;
  const sp = snapPos(x, y, w, h);
  const snapped = applyZoneSnap(sp.x, sp.y, w, h);
  ghost.style.left = snapped.x+'px';
  ghost.style.top = snapped.y+'px';
  ghost.style.width = w+'px';
  ghost.style.height = h+'px';
  // `rotation` is optional (only pieces have one — tokens/zones never pass
  // it) and, when given, is the same effectivePieceRotation(p) the actual
  // .piece element itself rotates by (see renderBoard). x/y/w/h above are
  // always pieceBounds' own UNROTATED box (same one .piece's left/top/width/
  // height already use), so rotating this ghost the same way, around the
  // same default center pivot (.piece's own transform-origin, for anything
  // that isn't a splayed multi-card pile — the only case with a rotation
  // that's ever actually nonzero here, see effectivePieceRotation), is what
  // makes the dashed outline finally trace the card's real on-screen footprint
  // instead of always sitting flat no matter how the piece itself is turned.
  ghost.style.transform = rotation ? `rotate(${rotation}deg)` : '';
}
// A pile's drag silhouette: mirrors the live piece element's own box and
// rotation at the snapped landing spot, with one outline per card copied from
// each real card's position/rotation — so it traces a rotated or splayed pile
// (including individually rotated cards) exactly.
function updatePieceDragGhost(ghost, p, pieceEl){
  if(!ghost || !ghost.isConnected) return;
  const b = pieceBounds(p);
  if(!pieceEl){ updateDragGhost(ghost, b.x, b.y, b.w, b.h, effectivePieceRotation(p)); return; }
  const anchor = snapPos(p.x, p.y, PIECE_W, PIECE_H); // same as the real drop (finishWholeMove)
  const snapped = applyZoneSnap(b.x + (anchor.x - p.x), b.y + (anchor.y - p.y), b.w, b.h);
  ghost.classList.add('piece-ghost');
  ghost.style.left = snapped.x+'px'; ghost.style.top = snapped.y+'px';
  ghost.style.width = b.w+'px'; ghost.style.height = b.h+'px';
  ghost.style.transform = pieceEl.style.transform;
  ghost.style.transformOrigin = pieceEl.style.transformOrigin;
  const cards = [...pieceEl.querySelectorAll(':scope > .splay-card:not(.splay-gap), :scope > .piece-face')];
  ghost.innerHTML = cards.map(c=>
    `<div class="ghost-card" style="left:${c.offsetLeft}px;top:${c.offsetTop}px;width:${c.offsetWidth}px;height:${c.offsetHeight}px;transform:${c.style.transform||'none'};"></div>`
  ).join('');
}
function removeDragGhost(ghost){
  if(ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
}
/* =========================================================================
   BOARD → HAND drag support — the mirror of wireHandCardDrag (which handles
   hand → board). Shared by any single-card drag gesture (a plain single-card
   piece move, or peeling one card off a pile): while the cursor is over the
   hand panel, the in-world drag-ghost is useless (it lives inside the board
   viewport and would either get clipped or, since it's non-positioned like
   everything else in normal flow, paint underneath the hand panel's own
   background — the "tucks itself underneath" bug), so instead a fixed-
   position floating card (reusing the same .hand-drop-ghost the hand→board
   drag already uses) rides the cursor above every layer in the app, and the
   panel itself lights up so the drop target is obvious before you let go.
   ========================================================================= */
function isOverHandPanel(clientX, clientY){
  const r = document.getElementById('hand-panel').getBoundingClientRect();
  return clientX>=r.left && clientX<=r.right && clientY>=r.top && clientY<=r.bottom;
}
let handDropGhostEl = null;
function showHandDropFeedback(cardId, clientX, clientY){
  document.getElementById('hand-panel').classList.add('hand-drop-target');
  if(!handDropGhostEl){
    handDropGhostEl = document.createElement('div');
    handDropGhostEl.className = 'hand-card hand-drop-ghost';
    document.body.appendChild(handDropGhostEl);
  }
  const card = cardsById.get(cardId);
  handDropGhostEl.innerHTML = `<div class="face">${cardFrontInnerHtml(card,300)}</div>`;
  handDropGhostEl.style.left = (clientX-35)+'px';
  handDropGhostEl.style.top = (clientY-49)+'px';
}
function clearHandDropFeedback(){
  document.getElementById('hand-panel').classList.remove('hand-drop-target');
  if(handDropGhostEl){ handDropGhostEl.remove(); handDropGhostEl=null; }
}
// Drags a single, unstacked card piece off the board straight into the hand —
// the board-side mirror of dragging a hand card out onto the board. Only a
// real card can enter the hand; a custom image piece just isn't one.
function sendPieceToHand(p){
  if(p.kind==='image' || p.cardIds.length!==1) return; // not reachable normally, but stay safe
  const cardId = p.cardIds[0];
  const original = {x:p.x, y:p.y, rotation:p.rotation, label:p.label, locked:p.locked};
  doAction('REMOVE_PIECE', {id:p.id});
  state.hand.push(cardId);
  renderHand();
  syncHandCount();
  setUndo(()=>{
    state.hand.pop();
    renderHand();
    syncHandCount();
    doAction('PLACE_PIECE', { id:p.id, x:original.x, y:original.y, cardIds:[cardId], faceStates:[true], owner:p.owner, label:original.label, rotation:original.rotation, locked:original.locked });
  });
}
// Pulls exactly one card (by index — the top card, or, on a splayed pile,
// whichever one was grabbed) out of a pile IMMEDIATELY — the moment a peel
// drag actually starts, not whenever it eventually lands — as an actual
// real, independent piece on the board (not a ghost) at the point it was
// grabbed, so the source pile's count/render updates the instant the card is
// picked up AND the card itself is, from that point on, a normal floating
// piece: see driveWholePieceDrag/finalizeWholePieceDrop, which take it from
// here exactly the same way they handle any other whole-piece drag (hand,
// merge, or tucking into a splayed pile showing its own face). Returns a
// ctx ready to hand straight to driveWholePieceDrag; its `sourceRestore`
// is what finalizeWholePieceDrop composes onto the landing undo so a single
// Undo reverses the whole gesture, pickup and landing together. Null if the
// index was already stale (shouldn't normally happen — nothing else can
// touch this pile mid-drag on the same client).
function beginPeelAsPiece(p, cardIndex, clientX, clientY){
  if(!p || cardIndex<0 || cardIndex>=p.cardIds.length) return null;
  const cardId = p.cardIds[cardIndex];
  const faceUp = p.faceStates[cardIndex];
  const cardRotations = p.cardRotations || p.cardIds.map(()=>0);
  // The rotation this card is ACTUALLY showing right now, carried over as the
  // new standalone piece's own rotation. Only meaningful to read from
  // cardRotations while the pile is splayed (see effectivePieceRotation's
  // comment: a splayed pile's own cards can each carry a separate rotation on
  // top of the container's) — an UNSPLAYED pile never paints per-card
  // rotations at all, its cards all just ride along with the whole
  // container's own `rotation` (ROTATE_PIECE), so peeling from one of those
  // has to read p.rotation instead, or a card rotated as part of a rigid
  // unsplayed stack would visually snap back to upright the instant it's
  // peeled off.
  const cardRotation = absCardRotation(p, cardIndex); // the angle it's showing right now — see ROTATION MODEL
  const remainingCardIds = p.cardIds.filter((_,i)=>i!==cardIndex);
  const remainingFaceStates = p.faceStates.filter((_,i)=>i!==cardIndex);
  const remainingCardRotations = cardRotations.filter((_,i)=>i!==cardIndex);
  const originalCardIds = [...p.cardIds], originalFaceStates = [...p.faceStates], originalCardRotations = [...cardRotations];
  const sourceId = p.id;
  doAction('DRAW_TOP', { id:sourceId, remainingCardIds, remainingFaceStates, remainingCardRotations, destination:'board' });
  const world = clientToWorld(clientX, clientY);
  const {x, y} = snapPos(world.x - PIECE_W/2, world.y - PIECE_H/2, PIECE_W, PIECE_H);
  const newId = newPieceId();
  doAction('PLACE_PIECE', { id:newId, x, y, cardIds:[cardId], faceStates:[faceUp], cardRotations:[0], rotation:cardRotation, owner:state.playerId });
  const newPiece = state.pieces.get(newId);
  if(!newPiece) return null;
  return {
    p:newPiece, el:null, ghost:null, tucked:false, startX:x, startY:y,
    pickupClientX:clientX, pickupClientY:clientY,
    sourceRestore: ()=>{
      doAction('REMOVE_PIECE', {id:newId});
      doAction('RESTORE_PIECE_CARDS', {id:sourceId, cardIds:originalCardIds, faceStates:originalFaceStates, cardRotations:originalCardRotations});
    },
  };
}
// Shared landing logic for a whole-piece move (used by both a plain drag on a
// single-card/image piece, and a drag from the "move whole stack" handle on a
// multi-card pile) — snap, merge-check, sync, and undo, all in one place.
function finishWholeMove(p, startX, startY, clientX, clientY){
  // Dropped on another tab's name: it moves to that tab, keeping its spot.
  const toTab = tabAtPoint(clientX, clientY);
  if(toTab){ p.x = startX; p.y = startY; moveObjectsToTab([{kind:'piece', id:p.id}], toTab); renderBoard(); return; }
  // A whole stack (2+ cards) only ever lands ON TOP of another pile — see stackDropTarget.
  if(p.kind!=='image' && p.cardIds.length>1){
    const stackTarget = stackDropTarget(p);
    if(stackTarget){ mergePieceOntoTarget(p.id, stackTarget.id, stackTarget.cardIds.length); return; }
  }
  const target = (p.kind==='image' || p.cardIds.length>1) ? null : resolveDragTarget(p, clientX, clientY); // custom images never merge into/onto card piles
  if(target){
    const world = clientToWorld(clientX, clientY);
    // Letting go while previewing a brand-new splay (see
    // singleOverSingleSplayPreview/driveWholePieceDrag's newSplay branch)
    // creates that splay in the same merge, rather than an ordinary
    // top/bottom placement.
    const sameTurn = canSplayWith(target, absCardRotation(p, 0));
    const newSplay = (!sameTurn || (target.splayed && target.cardIds.length>1)) ? null : singleOverSingleSplayPreview(target, p.cardIds.length, p.x+PIECE_W/2, p.y+PIECE_H/2);
    if(newSplay){
      mergePieceOntoTarget(p.id, target.id, 0, newSplay);
      return;
    }
    // A SPLAYED target inserts at the exact fanned position it was
    // previewing (see splayInsertIndex — keyed off the dragged piece's OWN
    // board position, p.x/p.y, not the cursor); an actual unsplayed STACK
    // (2+ cards) uses the coarser cursor-based top/bottom-only rule
    // (shouldInsertBelow). A lone single card is neither of those — it's
    // governed entirely by singleOverSingleSplayPreview above, so outside
    // its splay zone the only outcome is an ordinary on-top merge (see that
    // function's own comment on why shouldInsertBelow's much smaller
    // threshold must NOT also apply here — it used to fire first and made
    // this look identical to hovering a real stack).
    const insertIndex = (target.splayed && target.cardIds.length>1)
      ? (sameTurn ? splayInsertIndex(target, p.x, p.y) : target.cardIds.length) // turned differently: onto the top, no tuck
      : (target.cardIds.length>1)
        ? (shouldInsertBelow(target, world.x, world.y) ? 0 : target.cardIds.length)
        : target.cardIds.length;
    mergePieceOntoTarget(p.id, target.id, insertIndex); // re-renders the board itself, sets its own undo
    return;
  }
  ({x:p.x, y:p.y} = snapPos(p.x, p.y, PIECE_W, PIECE_H));
  ({x:p.x, y:p.y} = applyZoneSnap(p.x, p.y, pieceW(p), pieceH(p)));
  postRoomEvent('MOVE_PIECE', {id:p.id, x:p.x, y:p.y});
  renderBoard(); // reflect the snap, if any
  if(p.x!==startX || p.y!==startY){
    setUndo(()=> doAction('MOVE_PIECE', {id:p.id, x:startX, y:startY}));
  }
}
// Any token(s) attached to a piece ride along with it live while it's being
// dragged, not just once the drag ends and the board re-renders — called on
// every move tick of a whole-piece drag, right after the piece's own element
// is repositioned. Mirrors the exact same offset renderTokens() uses to place
// an attached token (top-right corner of the host), so there's no visual pop
// when the drag ends and a real render takes over.
function repositionAttachedTokens(pieceId){
  const host = state.pieces.get(pieceId); if(!host) return;
  state.tokens.forEach(t=>{
    if(t.attachedTo !== pieceId) return;
    // Each attached token rides its own specific card (attachedTokenPos), not
    // a single shared corner — different tokens on the same splayed pile can
    // land at different points along the fan.
    const pos = attachedTokenPos(t);
    if(!pos) return;
    const el = document.querySelector(`.token[data-id="${t.id}"]`);
    if(el){ el.style.left = pos.x+'px'; el.style.top = pos.y+'px'; }
  });
}
// Shared engine behind every "this is now a real, independent piece
// following the cursor" drag — a piece that already existed before the drag
// (wireWholeInteraction) and a piece that was JUST created the instant this
// particular drag started (peeling a card off a pile, or playing one from
// hand — see beginPeelAsPiece) both run through the exact same code from
// here on, so they look and behave identically: hand-drop feedback, a merge
// highlight over an ordinary pile, or — hovering a SPLAYED pile — the piece
// itself relocating into the fan at the exact previewed slot, showing its
// own face there (see setSplayPreview/renderBoard) instead of a separate
// ghost-plus-silhouette. Moving back out before releasing un-tucks it
// cleanly and it resumes following the cursor as a normal floating piece.
//
// `ctx` is `{p, el, ghost, tucked, startX, startY}` — `p` is the piece being
// dragged, `startX`/`startY` its world position at the moment THIS drag
// began (not necessarily its very first placement — for a freshly-peeled
// card that's the point it was picked up), and `el`/`ghost`/`tucked` are
// live drag state this function owns and updates in place.
function driveWholePieceDrag(ctx, dx, dy, ev){
  const p = state.pieces.get(ctx.p.id);
  if(!p) return; // consumed by something else mid-drag — shouldn't normally happen
  const canGoToHand = p.kind!=='image' && p.cardIds.length===1;
  if(canGoToHand && isOverHandPanel(ev.clientX, ev.clientY)){
    if(clearSplayPreview()) ctx.tucked = false; // no-op if it wasn't tucked
    if(ctx.ghost){ removeDragGhost(ctx.ghost); ctx.ghost=null; } // the board-space ghost has no meaning once we're over the hand
    ctx.el = null;
    clearMergeHighlight();
    showHandDropFeedback(p.cardIds[0], ev.clientX, ev.clientY);
    return;
  }
  clearHandDropFeedback();
  const d = screenDeltaToWorldDelta(dx, dy);
  p.x = ctx.startX+d.x; p.y = ctx.startY+d.y;
  const target = p.kind==='image' ? null : resolveDragTarget(p, ev.clientX, ev.clientY);
  const sameTurn = p.kind!=='image' && canSplayWith(target, absCardRotation(p, 0)); // see canSplayWith
  const splayTarget = sameTurn && target.splayed && target.cardIds.length>1 ? target : null;
  // Distinct from splayTarget above (tucking into an ALREADY-splayed pile):
  // this is hovering a single dragged card over another single, unsplayed
  // card, nudged far enough off-center to preview forming a brand-new splay
  // — see singleOverSingleSplayPreview's own comment. null while still close
  // to center (ordinary stack-on-top merge) or when either side isn't a lone
  // single card.
  const newSplay = (splayTarget || !sameTurn) ? null : singleOverSingleSplayPreview(target, p.cardIds.length, p.x+PIECE_W/2, p.y+PIECE_H/2);
  const world = clientToWorld(ev.clientX, ev.clientY);
  if(splayTarget){
    // Close enough to tuck: preview it with this piece's OWN card face (it's
    // always exactly one card here — image pieces never reach this branch,
    // and everything else that drives through this function is single-card),
    // and hide the loose floating piece entirely while that's showing — see
    // renderBoard's splayPreview.sourceId check — rather than also keeping a
    // ghost/silhouette around.
    clearMergeHighlight();
    // Keyed off the dragged piece's OWN board position (p.x/p.y, already
    // updated above this tick), not the cursor — see splayInsertIndex.
    const insertIndex = splayInsertIndex(splayTarget, p.x, p.y);
    setSplayPreview(splayTarget.id, insertIndex, {sourceId:p.id, cardId:p.cardIds[0], faceUp:p.faceStates[0], rotation:relCardRotation(splayTarget, absCardRotation(p, 0))});
    if(ctx.ghost){ removeDragGhost(ctx.ghost); ctx.ghost=null; }
    ctx.el = null;
    ctx.tucked = true;
    return;
  }
  if(newSplay){
    // Same "hide the loose floating piece, show its real face tucked in
    // place" treatment as the splayTarget branch above, but forming a BRAND
    // NEW splay rather than tucking into an existing one — always inserts at
    // index 0 (the target is always the anchor here, see
    // singleOverSingleSplayPreview's own comment).
    clearMergeHighlight();
    setSplayPreview(target.id, 0, {sourceId:p.id, cardId:p.cardIds[0], faceUp:p.faceStates[0], rotation:relCardRotation(target, absCardRotation(p, 0))}, newSplay);
    if(ctx.ghost){ removeDragGhost(ctx.ghost); ctx.ghost=null; }
    ctx.el = null;
    ctx.tucked = true;
    return;
  }
  // Not (or no longer) close enough to tuck — clearing a preview that was
  // showing rebuilds the board (the piece reappears in its own right there),
  // which drops any DOM reference we were holding; reacquire it below.
  if(clearSplayPreview()) ctx.tucked = false;
  if(target) showMergeHighlight(target.id); else clearMergeHighlight();
  // Also re-find it if it's gone stale: renderBoard rebuilds every piece from
  // scratch — a flip/rotate (or its little animation) on the held card, or any
  // other player's action, mid-drag — and moving the old detached element
  // would leave the visible card frozen in place.
  if(!ctx.el || !ctx.el.isConnected) ctx.el = document.querySelector(`.piece[data-id="${p.id}"]`);
  if(!ctx.el) return;
  if(!ctx.ghost || !ctx.ghost.isConnected) ctx.ghost = createDragGhost();
  ctx.el.classList.add('dragging-piece');
  placePieceEl(ctx.el, p);
  // Only a real multi-card STACK gets the bottom-third "insert below" hint —
  // a lone single-card target is governed entirely by singleOverSingleSplayPreview
  // above (which already returned null here, meaning plain stack-on-top), so
  // it must never also show this hint (see that function's comment on why
  // its old, much-smaller threshold used to leak through and make this look
  // identical to hovering a real stack).
  ctx.el.classList.toggle('insert-below', !!target && target.cardIds.length>1 && shouldInsertBelow(target, world.x, world.y));
  updatePieceDragGhost(ctx.ghost, p, ctx.el);
  repositionAttachedTokens(p.id);
}
// Lands a drag driven by driveWholePieceDrag, whichever gesture started it —
// hand if it's hovering the hand panel, otherwise finishWholeMove's usual
// merge-or-plain-place logic (which already knows about a splayed target's
// exact tuck slot). If `ctx.sourceRestore` is set (see beginPeelAsPiece —
// this piece didn't exist before this drag), it's composed onto whatever
// undo finishWholeMove/sendPieceToHand just set, so a single Undo reverses
// the WHOLE gesture — the pickup and wherever it landed — in one step.
function finalizeWholePieceDrop(ctx, ev){
  const p = state.pieces.get(ctx.p.id);
  clearMergeHighlight();
  clearSplayPreview();
  if(ctx.ghost) removeDragGhost(ctx.ghost);
  if(ctx.el) ctx.el.classList.remove('dragging-piece', 'insert-below');
  if(!p) return;
  const canGoToHand = p.kind!=='image' && p.cardIds.length===1;
  if(canGoToHand && isOverHandPanel(ev.clientX, ev.clientY)){
    clearHandDropFeedback();
    sendPieceToHand(p);
  } else {
    clearHandDropFeedback();
    finishWholeMove(p, ctx.startX, ctx.startY, ev.clientX, ev.clientY);
  }
  if(ctx.sourceRestore){
    const inner = state.undoFn, restore = ctx.sourceRestore;
    state.undoFn = ()=>{ if(inner) inner(); restore(); };
  }
}
// Whole-piece click+drag — used for image pieces and single-card piles, where
// there's nothing to "peel" so a plain drag just moves the one thing there is.
function wireWholeInteraction(el, p){
  let ctx = null;
  wirePressDragClick(el, {
    onDown: (e)=>{
      if(handlePieceSelectionOnDown(p, e)) return false;
      if(p.locked) return false;
      ctx = { p, el, ghost:null, tucked:false, startX:p.x, startY:p.y };
    },
    onMove: (dx, dy, ev)=> driveWholePieceDrag(ctx, dx, dy, ev),
    onClick: ()=>{ if(p.kind!=='image') flipTopCard(p.id); },
    onContext: (e)=> openPieceRadialMenu(p.id, e.clientX, e.clientY),
    onDrop: (dx, dy, ev)=>{
      finalizeWholePieceDrop(ctx, ev);
      ctx = null;
    },
  });
}
// The pile's label, doubling as its "move whole stack" handle — always a
// whole-piece move (never a peel), and a plain click on it opens the STACK
// radial menu (pile-wide actions only — Flip/Shuffle/Rotate/Label/Search/
// Lock/Remove, no per-card items — see openPieceRadialMenu) rather than
// moving anything. This is now the ONLY way to reach that menu: a click on
// the card face itself — whether that's an unsplayed pile's own top card
// (see wireStackInteraction) or any individual card picked out of a splay
// (see wirePeelInteraction/wireSplayAdjustDrag) — always opens the
// single-card menu instead, scoped to that one card. The label handle is
// what still represents "the pile as a whole."
function wireGroupHandleDrag(handleEl, p){
  let startX, startY, ghost=null;
  wirePressDragClick(handleEl, {
    onDown: (e)=>{
      if(handlePieceSelectionOnDown(p, e)) return false;
      if(p.locked) return false;
      startX = p.x; startY = p.y;
    },
    onMove: (dx, dy, ev)=>{
      const d = screenDeltaToWorldDelta(dx, dy);
      p.x = startX+d.x; p.y = startY+d.y;
      // A whole stack only ever goes ON TOP of another pile — no tucking into
      // a splay, no sliding underneath — so the only feedback is the target's
      // highlight. The piece element is looked up fresh by id each tick since
      // any re-render leaves handleEl itself stale.
      const target = stackDropTarget(p);
      if(target) showMergeHighlight(target.id); else clearMergeHighlight();
      if(!ghost || !ghost.isConnected) ghost = createDragGhost(); // renderBoard (a flip/rotate, or anyone else's action) wipes it mid-drag
      const pieceEl = document.querySelector(`.piece[data-id="${p.id}"]`);
      if(pieceEl){
        pieceEl.classList.add('dragging-piece');
        placePieceEl(pieceEl, p);
      }
      updatePieceDragGhost(ghost, p, pieceEl);
      repositionAttachedTokens(p.id);
    },
    // Left-click on the label does nothing (flipping a whole stack by a stray
    // click would be too easy); right-click opens the Stack menu.
    onContext: (e)=> openPieceRadialMenu(p.id, e.clientX, e.clientY), // the Stack menu — see comment above
    onDrop: (dx, dy, ev)=>{
      removeDragGhost(ghost); ghost=null;
      clearMergeHighlight();
      clearSplayPreview();
      const pieceEl = document.querySelector(`.piece[data-id="${p.id}"]`);
      if(pieceEl) pieceEl.classList.remove('dragging-piece', 'insert-below');
      finishWholeMove(p, startX, startY, ev.clientX, ev.clientY);
    },
  });
}
// Click+drag on ONE specific visible card of a multi-card (necessarily
// splayed — this only ever wires individual `.splay-card` elements) pile —
// a plain click opens the SINGLE-CARD radial menu scoped to that exact card
// (see openPieceRadialMenu), even for the anchor/top card, since picking any
// one card out of a splay means you're pointing at that card specifically,
// not "the pile" (reach the pile-wide Stack menu via its label handle
// instead — see wireGroupHandleDrag). A drag makes that exact card a real,
// independent piece the instant the drag starts (see beginPeelAsPiece) and
// drives it exactly like any other whole-piece drag from then on (see
// driveWholePieceDrag/finalizeWholePieceDrop) — following the cursor,
// merging into whatever pile it's dropped on, or tucking into a splayed
// pile's fan showing its own face at the exact previewed slot.
function wirePeelInteraction(cardEl, p, cardIndex){
  let ctx = null;
  wirePressDragClick(cardEl, {
    onDown: (e)=>{
      if(handlePieceSelectionOnDown(p, e)) return false;
      if(p.locked) return false;
    },
    onMove: (dx, dy, ev)=>{
      if(!ctx){ ctx = beginPeelAsPiece(p, cardIndex, ev.clientX, ev.clientY); if(!ctx) return; }
      driveWholePieceDrag(ctx, ev.clientX-ctx.pickupClientX, ev.clientY-ctx.pickupClientY, ev);
    },
    onClick: ()=> flipTopCard(p.id, cardIndex),
    onContext: (e)=> openPieceRadialMenu(p.id, e.clientX, e.clientY, cardIndex), // single-card menu for THIS card specifically
    onDrop: (dx, dy, ev)=>{
      if(!ctx) return;
      finalizeWholePieceDrop(ctx, ev);
      ctx = null;
    },
  });
}
// Moves every currently-selected (and unlocked) piece PLUS every currently-
// selected (and unattached) token by the same screen delta as whichever one
// was actually grabbed — a mixed piece+token selection always moves as one
// unit. No merge-onto-target and no zone-snap for group moves — keeps the
// interaction predictable when several things are involved at once. A plain
// click (no real movement) opens the grabbed item's own radial menu, same as
// clicking it alone (outside any selection) does. `anchor` is {kind:'piece'|
// 'token', id} — whichever element the press actually started on.
function beginGroupDrag(anchor, downEvent){
  const pieceMembers = [...state.selectedIds].map(id=>state.pieces.get(id)).filter(m=>m && !m.locked);
  const tokenMembers = [...state.selectedTokenIds].map(id=>state.tokens.get(id)).filter(m=>m && !m.attachedTo);
  if(!pieceMembers.length && !tokenMembers.length) return;
  const startPositions = pieceMembers.map(m=>({kind:'piece', id:m.id, x:m.x, y:m.y}))
    .concat(tokenMembers.map(m=>({kind:'token', id:m.id, x:m.x, y:m.y})));
  const startClientX=downEvent.clientX, startClientY=downEvent.clientY;
  let moved=false;
  // Purely a feel thing (see .group-lifted): every member glows a bit
  // brighter and rises above its neighbors for as long as the group is
  // actually being dragged around.
  function setLifted(on){
    startPositions.forEach(sp=>{
      const el = document.querySelector(sp.kind==='piece' ? `.piece[data-id="${sp.id}"]` : `.token[data-id="${sp.id}"]`);
      if(el) el.classList.toggle('group-lifted', on);
    });
  }
  function onMove(ev){
    const dx=ev.clientX-startClientX, dy=ev.clientY-startClientY;
    if(!moved){
      if(Math.hypot(dx,dy) < DRAG_THRESHOLD) return;
      moved = true;
      setLifted(true);
    }
    const d = screenDeltaToWorldDelta(dx, dy);
    startPositions.forEach(sp=>{
      if(sp.kind==='piece'){
        const mp = state.pieces.get(sp.id); if(!mp) return;
        mp.x = sp.x+d.x; mp.y = sp.y+d.y;
        const elm = document.querySelector(`.piece[data-id="${sp.id}"]`);
        if(elm) placePieceEl(elm, mp);
        repositionAttachedTokens(sp.id);
      } else {
        const mt = state.tokens.get(sp.id); if(!mt) return;
        mt.x = sp.x+d.x; mt.y = sp.y+d.y;
        const elm = document.querySelector(`.token[data-id="${sp.id}"]`);
        if(elm){ elm.style.left=mt.x+'px'; elm.style.top=mt.y+'px'; }
      }
    });
  }
  function onUp(ev){
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if(!moved){
      // A plain left-click on a selected card flips just that card, same as
      // outside a selection (right-click still opens its menu).
      if(anchor.kind==='piece'){
        const ap = state.pieces.get(anchor.id);
        const splayCard = downEvent.target.closest && downEvent.target.closest('.splay-card:not(.splay-gap)');
        if(ap && ap.kind!=='image' && !downEvent.target.closest('.stack-handle')) flipTopCard(anchor.id, splayCard ? Number(splayCard.dataset.i) : undefined);
      }
      return;
    }
    const toTab = tabAtPoint(ev.clientX, ev.clientY);
    if(toTab){
      // The whole selection goes to that tab, each keeping its spot.
      startPositions.forEach(sp=>{ const m = (sp.kind==='piece' ? state.pieces : state.tokens).get(sp.id); if(m){ m.x = sp.x; m.y = sp.y; } });
      moveObjectsToTab(startPositions.map(sp=>({kind:sp.kind, id:sp.id})), toTab);
      renderBoard();
      return;
    }
    const d = screenDeltaToWorldDelta(ev.clientX-startClientX, ev.clientY-startClientY);
    startPositions.forEach(sp=>{
      if(sp.kind==='piece'){
        const mp = state.pieces.get(sp.id); if(!mp) return;
        ({x:mp.x, y:mp.y} = snapPos(sp.x+d.x, sp.y+d.y, PIECE_W, PIECE_H));
        postRoomEvent('MOVE_PIECE', {id:mp.id, x:mp.x, y:mp.y});
      } else {
        const mt = state.tokens.get(sp.id); if(!mt) return;
        ({x:mt.x, y:mt.y} = snapPos(sp.x+d.x, sp.y+d.y, tokenSize(mt), tokenSize(mt)));
        postRoomEvent('MOVE_TOKEN', {id:mt.id, x:mt.x, y:mt.y, attachedTo:null});
      }
    });
    renderBoard(); // rebuilds every element fresh, so setLifted(false) would be a no-op — skipped
    // One satisfying little settle-bounce (see .group-settle) once everything
    // has actually landed in its new spot.
    startPositions.forEach(sp=>{
      const el = document.querySelector(sp.kind==='piece' ? `.piece[data-id="${sp.id}"]` : `.token[data-id="${sp.id}"]`);
      if(el) el.classList.add('group-settle');
    });
    setUndo(()=>{
      startPositions.forEach(sp=>{
        if(sp.kind==='piece') doAction('MOVE_PIECE', {id:sp.id, x:sp.x, y:sp.y});
        else doAction('MOVE_TOKEN', {id:sp.id, x:sp.x, y:sp.y, attachedTo:null});
      });
    });
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
// Drop-target detection for merging — any other piece whose footprint contains
// the drop point (in board-space, converted from the raw client coordinates).
function findOverlapTarget(draggedPiece, clientX, clientY){
  // clientToWorld, not plain pan/zoom math: this used to skip the board's
  // rotation, so on a rotated board it looked for a pile in the wrong place.
  const w = clientToWorld(clientX, clientY);
  return findPileAtWorld(w.x, w.y, draggedPiece.id);
}
// pieceBounds is the UNROTATED frame (see its comment). A pile turned 90°
// looks 196 wide and 140 tall on the table, so anything asking "is this
// point/card actually over that pile?" uses this instead: pieceBounds turned
// by the pile's own angle about its pivot (the anchor card's center, the
// same center .piece rotates around), as the box that covers it.
function pieceVisualBounds(p){
  const b = pieceBounds(p);
  const deg = normAngle(p.rotation||0);
  if(!deg) return b;
  const cx = p.x + (p.kind==='image' ? pieceW(p) : PIECE_W)/2, cy = p.y + (p.kind==='image' ? pieceH(p) : PIECE_H)/2;
  const pts = [[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]].map(([x,y])=> rotateVector(x-cx, y-cy, -deg));
  const xs = pts.map(v=> cx+v.x), ys = pts.map(v=> cy+v.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x:minX, y:minY, w:Math.max(...xs)-minX, h:Math.max(...ys)-minY };
}
function findPileAtWorld(worldX, worldY, excludeId){
  for(const p of state.pieces.values()){
    if(p.id===excludeId || p.kind==='image' || !onCurrentTab(p)) continue; // custom images are never a merge target
    const b = pieceVisualBounds(p);
    if(worldX>=b.x && worldX<=b.x+b.w && worldY>=b.y && worldY<=b.y+b.h) return p;
  }
  return null;
}
// A whole STACK being dragged (2+ cards) has exactly one way to join another
// pile: on top. Its target is whatever pile is under the middle of its own
// top card — the part you're holding over the other pile — rather than the
// cursor, which sits on the stack's label just past its edge.
function stackDropTarget(p){
  return findPileAtWorld(p.x + PIECE_W/2, p.y + PIECE_H/2, p.id);
}
// A single dragged card hovering another single, unsplayed card (the one
// case singleOverSingleSplayPreview covers) is judged by whether the two
// cards' own FOOTPRINTS are touching at all — not by findOverlapTarget's
// cursor-point check above. Those two used to disagree in exactly the cases
// that matter: the cursor moves in lockstep with whatever it's dragging, so
// by the time the dragged card has been nudged far enough off the target's
// CENTER to actually cross singleOverSingleSplayPreview's own threshold and
// preview a splay, the cursor itself has already left the target's own
// small 140x196 hit-box (unless it happened to be grabbed dead-center and
// nudged less than half a card-width) — so a plain cursor-point check would
// leave the tuck gesture unreachable for almost any real grab point. This
// only kicks in as a fallback, when the cursor-point check finds nothing at
// all (see resolveDragTarget below) — so it never changes the existing
// cursor-precise behavior for hovering a bigger stack or a splayed pile.
function findSingleCardTuckTarget(draggedPiece){
  const db = pieceVisualBounds(draggedPiece);
  let best = null, bestDist = Infinity;
  state.pieces.forEach(p=>{
    if(p.id===draggedPiece.id || p.kind==='image' || !onCurrentTab(p)) return;
    if(p.splayed || p.cardIds.length!==1) return; // only a lone unsplayed single card is a tuck target
    const b = pieceVisualBounds(p);
    const touching = db.x < b.x+b.w && db.x+db.w > b.x && db.y < b.y+b.h && db.y+db.h > b.y;
    if(!touching) return;
    const dx = (db.x+db.w/2)-(b.x+b.w/2), dy = (db.y+db.h/2)-(b.y+b.h/2);
    const dist = dx*dx + dy*dy;
    if(dist < bestDist){ bestDist = dist; best = p; }
  });
  return best;
}
// The single point every whole-piece-drag merge/tuck/splay decision should
// resolve its target through: the cursor-point check first (unchanged, and
// still what decides hovering a splayed pile or an ordinary multi-card
// stack), falling back to the footprint-touching check above ONLY when the
// cursor has found nothing AND the dragged piece is itself a lone single
// card — exactly the gap findSingleCardTuckTarget exists to fill, and
// nothing more.
function resolveDragTarget(p, clientX, clientY){
  const cursorTarget = p.kind==='image' ? null : findOverlapTarget(p, clientX, clientY);
  if(cursorTarget) return cursorTarget;
  if(p.kind!=='image' && p.cardIds.length===1) return findSingleCardTuckTarget(p);
  return null;
}
// Live merge feedback: while a drag is hovering a valid merge target (exactly
// the piece findOverlapTarget would return if dropped right now), that piece
// gets a green outline and its card-count badge flips to a green "+" — so
// there's no ambiguity about whether letting go will place the card there.
// Only ever one target highlighted at a time; cleared on every drag tick that
// isn't over a target, and always on drop/cancel.
// While a peeled/hand-played card is being dragged over a splayed pile, this
// holds where it would land if dropped right now — {targetId, insertIndex}
// (insertIndex is an index into that pile's cardIds array, same convention
// DRAW_TOP/MERGE_PIECES use: 0 = new bottom card, cardIds.length = new top
// card). renderBoard()'s splayed-pile branch reads it to open a preview gap;
// it's never itself a source of truth for real state.
// cardInfo, when given, is {sourceId, cardId, faceUp, rotation} for a single
// dragged card — sourceId is the piece currently being dragged (skipped from
// its own normal rendering, see renderBoard) and cardId/faceUp/rotation are
// what's drawn for real, at its own current rotation, in the preview slot
// inside the target's fan (see renderBoard's splayed-pile branch). Omit it
// (or pass null/undefined) for the old blank dashed-placeholder preview,
// still used for a multi-card whole-pile drag where there's no single face
// to show.
// newSplayInfo, when given, is {dir, spacing} for a target that ISN'T
// actually splayed (yet) — see singleOverSingleSplayPreview: hovering a
// single dragged card far enough off-center over another single, unsplayed
// card previews forming a brand-new 2-card splay rather than the ordinary
// tuck-into-an-existing-fan case cardInfo alone handles. renderBoard reads
// this to render the target AS IF already splayed (anchor + one fanned
// card), using these dir/spacing values instead of the target's own (since
// it has none yet); dropping while this shows creates the real splay (see
// mergePieceOntoTarget's splayInfo param).
let splayPreview = null;
function setSplayPreview(targetId, insertIndex, cardInfo, newSplayInfo){
  const next = cardInfo
    ? {targetId, insertIndex, sourceId:cardInfo.sourceId, cardId:cardInfo.cardId, faceUp:cardInfo.faceUp, rotation:cardInfo.rotation||0}
    : {targetId, insertIndex, sourceId:null, cardId:null, faceUp:null, rotation:0};
  next.newSplay = newSplayInfo ? {dir:newSplayInfo.dir, spacing:newSplayInfo.spacing} : null;
  if(splayPreview && splayPreview.targetId===next.targetId && splayPreview.insertIndex===next.insertIndex
     && splayPreview.sourceId===next.sourceId && splayPreview.cardId===next.cardId && splayPreview.rotation===next.rotation
     && splayPreview.faceUp===next.faceUp
     && !!splayPreview.newSplay===!!next.newSplay
     && (!next.newSplay || (splayPreview.newSplay.dir===next.newSplay.dir && splayPreview.newSplay.spacing===next.newSplay.spacing))) return false;
  splayPreview = next;
  renderBoard();
  return true;
}
function clearSplayPreview(){
  if(!splayPreview) return false;
  splayPreview = null;
  renderBoard();
  return true;
}
// Where an incoming card, whose own board-space TOP-LEFT corner is
// (cardX,cardY), would land in a splayed pile's fan — specifically, the
// slot whose depth-implied position is closest to where that card would
// actually be sitting right now if it weren't tucking into anything at all.
// Each depth d's own left edge (for a horizontal splay; top edge for
// vertical) sits at target.x plus/minus d*spacing (see renderBoard's
// offsetFor — same convention, ignoring that function's own per-card
// rotation compensation, which only ever nudges a card a few px and isn't
// worth the noise here), so comparing cardX/cardY — the card's OWN edge, not
// the cursor's raw position, which can sit anywhere within or even outside
// the card depending on where it was grabbed — against that same axis is
// what actually answers "which slot is this card closest to." Near the
// anchor (the top card) this naturally resolves to insertIndex===cardIds.length
// — an ordinary top-of-pile insert — and at the far end of the fan it
// resolves to 0 — an ordinary bottom-of-pile insert — so no separate
// top/bottom special-casing is needed on top of this.
function splayInsertIndex(target, cardX, cardY){
  const dir = target.splayDir || 'right';
  const spacing = target.splaySpacing || 36;
  const n = target.cardIds.length;
  let axisPos;
  if(dir==='right') axisPos = cardX - target.x;
  else if(dir==='left') axisPos = target.x - cardX;
  else if(dir==='down') axisPos = cardY - target.y;
  else axisPos = target.y - cardY; // 'up'
  const depth = Math.max(0, Math.min(n, Math.round(axisPos / spacing)));
  return n - depth;
}
let mergeHighlightId = null;
function showMergeHighlight(pieceId){
  if(mergeHighlightId === pieceId) return;
  clearMergeHighlight();
  const el = document.querySelector(`.piece[data-id="${pieceId}"]`);
  if(!el) return;
  el.classList.add('merge-target');
  const target = state.pieces.get(pieceId);
  const prefix = target && target.label ? escapeHtml(target.label)+' ' : '';
  let labelEl = el.querySelector('.piece-label');
  if(labelEl){
    labelEl.dataset.origHtml = labelEl.innerHTML;
    labelEl.innerHTML = prefix + '+';
  } else {
    // No label pill on the board yet (an unlabeled single card) — the merge
    // still needs SOME visual cue, so add one temporarily, docked to the
    // same fixed anchor spot a real stack-handle label would use.
    labelEl = document.createElement('div');
    labelEl.className = 'piece-label merge-temp';
    labelEl.innerHTML = prefix + '+';
    labelEl.style.cssText = `left:${PIECE_W/2}px;right:auto;bottom:auto;top:${PIECE_H-16}px;width:max-content;transform:translateX(-50%);`;
    el.appendChild(labelEl);
  }
  mergeHighlightId = pieceId;
}
function clearMergeHighlight(){
  if(!mergeHighlightId) return;
  const el = document.querySelector(`.piece[data-id="${mergeHighlightId}"]`);
  if(el){
    el.classList.remove('merge-target');
    const tempBadge = el.querySelector('.piece-label.merge-temp');
    if(tempBadge){ tempBadge.remove(); }
    else {
      const labelEl = el.querySelector('.piece-label');
      if(labelEl && labelEl.dataset.origHtml!==undefined){
        labelEl.innerHTML = labelEl.dataset.origHtml;
        delete labelEl.dataset.origHtml;
      }
    }
  }
  mergeHighlightId = null;
}
// Flips ONE card's face — the pile's own top card by default, or a specific
// `cardIndex` (any card of a splay, from the single-card radial menu or the
// F hotkey while hovering that card — see hoveredCardIndex).
function flipTopCard(pieceId, cardIndex){
  const p = state.pieces.get(pieceId); if(!p || !p.faceStates.length) return;
  const idx = cardIndex!=null ? cardIndex : p.faceStates.length-1;
  if(idx<0 || idx>=p.faceStates.length) return;
  const oldFace = p.faceStates[idx];
  const newFace = !oldFace;
  doAction('FLIP_TOP', {id:pieceId, faceUp:newFace, cardIndex:idx});
  setUndo(()=> doAction('FLIP_TOP', {id:pieceId, faceUp:oldFace, cardIndex:idx}));
}
// Rotates a SPECIFIC card of a SPLAYED pile by index (`cardIndex` non-null),
// used wherever the target card is already known explicitly — the
// single-card radial menu, and rotatePiece below once it's resolved which
// card (if any) the hotkey should actually be targeting. cardIndex===null
// (or the pile isn't splayed/multi-card) rotates the WHOLE piece in place
// instead — a "tap", independent of the shared board-view rotation, cycling
// 0→90→180→270→0 forward, or the reverse with dir=-1 — same as ever for an
// unsplayed pile, a single card, or an image, none of which have individual
// cards to pick between.
function rotateCardAt(pieceId, cardIndex, dir){
  const p = state.pieces.get(pieceId); if(!p) return;
  if(p.splayed && p.cardIds.length>1 && cardIndex!=null && cardIndex<p.cardIds.length){
    const cardRotations = p.cardRotations || p.cardIds.map(()=>0);
    const old = cardRotations[cardIndex]||0;
    const next = (old + (dir||1)*90 + 360) % 360;
    doAction('ROTATE_CARD', {id:pieceId, cardIndex, rotation:next});
    setUndo(()=> doAction('ROTATE_CARD', {id:pieceId, cardIndex, rotation:old}));
    return;
  }
  const old = p.rotation||0;
  const next = (old + (dir||1)*90 + 360) % 360;
  doAction('ROTATE_PIECE', {id:pieceId, rotation:next});
  setUndo(()=> doAction('ROTATE_PIECE', {id:pieceId, rotation:old}));
}
// R hotkey: rotates whichever card (if any) is currently hovered within a
// SPLAYED pile (see hoveredCardIndex/wireCardHoverIndex) — anywhere else
// (an unsplayed pile, a single card, an image, or just not hovering any one
// card of the splay right now) there's no individual card to pick, so the
// whole piece rotates as one unit, same as ever.
function rotatePiece(pieceId, dir){
  const p = state.pieces.get(pieceId); if(!p) return;
  const idx = (p.splayed && p.cardIds.length>1 && hoveredCardIndex!=null) ? hoveredCardIndex : null;
  rotateCardAt(pieceId, idx, dir);
}
// Discards exactly ONE card from a pile outright — no hand/board destination,
// unlike Draw — leaving the rest of the pile (splayed or not) otherwise
// intact. Reuses the SEARCH_REMOVE machinery (a generic "here's the pile's
// new card list" event, same as confirmSearchRemove/drawTopCard) rather than
// inventing a new one — the only thing that changes is that nothing gets
// pushed to hand or placed on the board with the removed card. If this was
// the pile's last card, setPieceCards' own empty-array check deletes the
// whole piece, same as it always has.
function removeCard(pieceId, cardIndex){
  const p = state.pieces.get(pieceId); if(!p || cardIndex<0 || cardIndex>=p.cardIds.length) return;
  const cardRotations = p.cardRotations || p.cardIds.map(()=>0);
  const originalCardIds = [...p.cardIds], originalFaceStates = [...p.faceStates], originalCardRotations = [...cardRotations];
  const remainingCardIds = p.cardIds.filter((_,i)=>i!==cardIndex);
  const remainingFaceStates = p.faceStates.filter((_,i)=>i!==cardIndex);
  const remainingCardRotations = cardRotations.filter((_,i)=>i!==cardIndex);
  doAction('REMOVE_CARD', {id:pieceId, remainingCardIds, remainingFaceStates, remainingCardRotations});
  setUndo(()=> doAction('RESTORE_PIECE_CARDS', {id:pieceId, cardIds:originalCardIds, faceStates:originalFaceStates, cardRotations:originalCardRotations}));
}
// Locking a pile only blocks dragging it (see wirePieceDrag) — flip/rotate/draw etc.
// all still work, since lock is about "don't let me bump this out of place".
function togglePieceLock(pieceId){
  const p = state.pieces.get(pieceId); if(!p) return;
  const newLocked = !p.locked;
  doAction('SET_PIECE_LOCK', {id:pieceId, locked:newLocked});
  setUndo(()=> doAction('SET_PIECE_LOCK', {id:pieceId, locked:!newLocked}));
}
function toggleZoneLock(zoneId){
  const z = state.zones.get(zoneId); if(!z) return;
  const newLocked = !z.locked;
  doAction('SET_ZONE_LOCK', {id:zoneId, locked:newLocked});
  setUndo(()=> doAction('SET_ZONE_LOCK', {id:zoneId, locked:!newLocked}));
}

