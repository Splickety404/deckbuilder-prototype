/* =========================================================================
   BOARD GEOMETRY — piece footprints, splay bounds, attached-token placement.
   ========================================================================= */
const PIECE_W = 140, PIECE_H = 196; // board-space px at scale 1 — matches the .piece CSS size, and is the
// fixed footprint of every ordinary card-stack piece. A custom-image piece (kind:'image')
// carries its OWN w/h instead (any scale the uploader picked), so anywhere the board needs
// a piece's actual footprint, use pieceW(p)/pieceH(p) rather than the PIECE_W/PIECE_H constants.
// A splayed pile's true on-screen footprint can be far bigger than one card
// (a 50-card pile fanned out at the default spacing is nearly 2000px wide) —
// pieceW/pieceH have to reflect that extent, or everything that uses them to
// find a piece's actual bounding box (board-bounds/fitAll, merge/overlap hit
// testing, attached-token positioning, drag-ghost sizing) badly undershoots a
// splayed pile's real size and either can't "see" most of it or can't be
// dropped onto most of it.
function pieceW(p){
  if(p.kind==='image' && p.w) return p.w;
  if(p.splayed && p.cardIds && p.cardIds.length>1){
    const dir = p.splayDir || 'right';
    if(dir==='left' || dir==='right') return PIECE_W + (p.cardIds.length-1)*(p.splaySpacing||36);
  }
  return PIECE_W;
}
function pieceH(p){
  if(p.kind==='image' && p.h) return p.h;
  if(p.splayed && p.cardIds && p.cardIds.length>1){
    const dir = p.splayDir || 'right';
    if(dir==='up' || dir==='down') return PIECE_H + (p.cardIds.length-1)*(p.splaySpacing||36);
  }
  return PIECE_H;
}
// A piece's own p.x/p.y is always where its ANCHOR (the top card, for a
// splayed pile) sits — but that's only the same thing as the visual TOP-LEFT
// corner of its full footprint for a 'right'/'down' splay, where the fan
// grows in the positive x/y direction away from the anchor. A 'left' or 'up'
// splay grows BACKWARDS from the anchor (see renderBoard's offsetFor, which
// gives those directions a NEGATIVE offset), so the pile's real visual
// footprint actually starts up to pieceW(p)-PIECE_W / pieceH(p)-PIECE_H px
// BEFORE p.x/p.y, not at it. That's invisible for the pile's own on-screen
// rendering (an absolutely-positioned card can render outside its container's
// own box just fine), but anything that needs this piece's real bounding
// box — the drag ghost, click/overlap hit-testing, an attached token's
// corner, zoom-to-fit — was quietly using p.x/p.y as if it were always that
// box's top-left, putting all of those in the wrong place for any
// 'left'/'up' splay. This is the one place that correction lives, so every
// consumer of "this piece's real footprint" agrees with what's actually on
// screen. (Rotation needs no equivalent correction here: a splayed pile's
// CONTAINER never rotates — see effectivePieceRotation — only its individual
// cards do, and that's compensated for per-card, inside the fan itself.)
// Moves a piece's element to match p.x/p.y mid-drag. Goes through pieceBounds
// rather than writing p.x/p.y straight to left/top: a pile splayed 'left' or
// 'up' has its element's box start a whole fan-length before the anchor (see
// renderBoard), so writing the anchor position there made such piles jump by
// that much the moment they were grabbed, and jump back on drop.
function placePieceEl(el, p){
  const b = pieceBounds(p);
  el.style.left = b.x+'px'; el.style.top = b.y+'px';
}
function pieceBounds(p){
  const w = pieceW(p), h = pieceH(p);
  let x = p.x, y = p.y;
  if(p.splayed && p.cardIds && p.cardIds.length>1){
    if(p.splayDir==='left') x = p.x - (w-PIECE_W);
    else if(p.splayDir==='up') y = p.y - (h-PIECE_H);
  }
  return {x, y, w, h};
}
// A single card's own full footprint within a pile, in the same unrotated
// world-space frame pieceBounds/pieceW/pieceH already use (see pieceBounds'
// own comment on why rotation is deliberately left out of this frame
// app-wide) — for an unsplayed pile (or a lone card) that's just the whole
// piece; for a splayed one it's that card's own depth*spacing offset from
// the anchor along the splay axis (mirrors renderBoard's own offsetFor,
// minus the small per-card-rotation centering nudge that only matters for
// pixel-perfect rendering, not for picking a card or centering a token).
function cardWorldRect(p, cardIndex){
  const n = p.cardIds.length;
  if(!p.splayed || n<=1) return {x:p.x, y:p.y, w:PIECE_W, h:PIECE_H};
  const dir = p.splayDir || 'right';
  const spacing = p.splaySpacing || 36;
  const depth = (n-1) - cardIndex;
  let x=p.x, y=p.y;
  if(dir==='right') x = p.x + depth*spacing;
  else if(dir==='left') x = p.x - depth*spacing;
  else if(dir==='down') y = p.y + depth*spacing;
  else if(dir==='up') y = p.y - depth*spacing;
  return {x, y, w:PIECE_W, h:PIECE_H};
}
// The part of a card in a splay that ISN'T covered by the next card in the
// fan (see cardWorldRect + renderBoard's own DOM-paint-order comment: each
// card is covered by the one at the next depth down, except a `spacing`-wide
// sliver at its own OUTER edge, away from the anchor) — the anchor itself
// has nothing painted over it, so its whole rect is "visible". This is what
// an attached token centers itself in (see attachedTokenPos), so it always
// sits somewhere actually showing on that specific card rather than
// disappearing under the card in front of it.
function cardVisibleRect(p, cardIndex){
  const rect = cardWorldRect(p, cardIndex);
  const n = p.cardIds.length;
  if(!p.splayed || n<=1 || cardIndex===n-1) return rect; // anchor, or not splayed: fully visible
  const dir = p.splayDir || 'right';
  const spacing = Math.max(1, Math.min(p.splaySpacing || 36, (dir==='left'||dir==='right') ? rect.w : rect.h));
  if(dir==='right') return {x: rect.x+rect.w-spacing, y:rect.y, w:spacing, h:rect.h};
  if(dir==='left')  return {x: rect.x, y:rect.y, w:spacing, h:rect.h};
  if(dir==='down')  return {x: rect.x, y:rect.y+rect.h-spacing, w:rect.w, h:spacing};
  /* up */          return {x: rect.x, y:rect.y, w:rect.w, h:spacing};
}
// Which card of a pile a world-space point actually lands ON, i.e. the same
// card you'd visually see/click there — when a splay's cards overlap, that's
// whichever one is painted on top (smallest depth, see renderBoard's DOM
// order), not necessarily the first rect that happens to contain the point.
// Returns null if the point isn't over the piece at all (or the piece has no
// cards). Used when a token is dropped onto a pile, to attach it to the
// specific card underneath rather than the pile as a whole (see
// finishWholeTokenMove/attachedTokenPos).
function cardIndexAtPoint(p, worldX, worldY){
  if(!p.cardIds || !p.cardIds.length) return null;
  const topIndex = p.cardIds.length-1;
  if(!p.splayed || p.cardIds.length<=1){
    const r = cardWorldRect(p, topIndex);
    return (worldX>=r.x && worldX<=r.x+r.w && worldY>=r.y && worldY<=r.y+r.h) ? topIndex : null;
  }
  let best = null, bestDepth = Infinity;
  for(let i=0;i<p.cardIds.length;i++){
    const r = cardWorldRect(p, i);
    if(worldX>=r.x && worldX<=r.x+r.w && worldY>=r.y && worldY<=r.y+r.h){
      const depth = topIndex - i;
      if(depth < bestDepth){ bestDepth = depth; best = i; }
    }
  }
  return best;
}
// Where an ATTACHED token actually renders — centered in the specific card's
// visible sliver (cardVisibleRect) when the host is a card pile and the
// token remembers which card it's on; falls back to the host's own top-right
// corner (the old whole-pile behavior) when there's no specific card to
// place it on — an image piece, or a token attached before this existed /
// whose remembered card index no longer exists (cards removed since).
function attachedTokenPos(t){
  const host = state.pieces.get(t.attachedTo);
  if(!host) return null;
  const size = tokenSize(t);
  if(host.cardIds && host.cardIds.length && t.attachedCardIndex!=null && t.attachedCardIndex < host.cardIds.length){
    const vis = cardVisibleRect(host, t.attachedCardIndex);
    return { x: vis.x + vis.w/2 - size/2, y: vis.y + vis.h/2 - size/2 };
  }
  // Rides the host's top-right corner as the VIEWER sees it — the host's
  // visible box (a lone card/unsplayed pile turned 90° is wider than tall),
  // then whichever of its corners is top-right on screen.
  let hb = pieceBounds(host);
  if(!(host.splayed && host.cardIds.length>1) && (effectivePieceRotation(host) % 180) !== 0){
    const cx = hb.x + hb.w/2, cy = hb.y + hb.h/2;
    hb = {x:cx-hb.h/2, y:cy-hb.w/2, w:hb.h, h:hb.w};
  }
  const corner = boxPointToward(hb, state.viewRotation||0, 1, -1, 0);
  return { x: corner.x - size/2, y: corner.y - size/2 };
}

