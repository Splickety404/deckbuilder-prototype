/* =========================================================================
   DECK IMPORT — one shuffled, face-down pile containing every card from the
   deckbuilder's exported JSON (leader, Domination/Quest, Stronghold/Resistance,
   schemes, and the full main deck all mixed together). Pulling specific cards
   like the leader out is handled by the search tool (not built this round —
   for now this creates the pile; search/draw come next).
   ========================================================================= */
function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}
// No more overlay, no more waiting on the network before the pile even shows
// up: importing used to block on a full round-trip per set — including the
// per-set Drive-access check happening server-side (see fetchSheetCards ->
// Code.gs's getCardsBySheetId) — behind a modal spinner, which is exactly the
// "really slow" complaint. All the ids this deck needs are already known
// straight from the deck file itself (no fetch required for THAT part), so
// the pile is placed immediately via the ordinary PLACE_PIECE path, which
// already registers "Access Pending" placeholders and kicks off
// ensureSheetsLoaded in the background on its own (see applyRoomEvent's
// PLACE_PIECE case) — importDeckJson doesn't need to duplicate any of that
// anymore, just hand it sourceSheets like any other piece. Real faces (or
// "Classified") pop in per-set as each one resolves, never all-or-nothing.
async function importDeckJson(deckJson, dropX, dropY){
  if(!deckJson || !deckJson.deckType) throw new Error('Not a recognized deck file.');
  if(!deckJson.sourceSheets || !deckJson.sourceSheets.length){
    throw new Error('This deck file has no sourceSheets info — re-export it from the latest deckbuilder version.');
  }
  // The deck goes down in its own list order, NOT shuffled — leader, bonus,
  // extra, schemes, then the main deck in its saved order — with the first
  // card on top (a pile's top card is its LAST array entry).
  const order = [];
  if(deckJson.leaderId) order.push(deckJson.leaderId);
  if(deckJson.bonusCardId) order.push(deckJson.bonusCardId);
  if(deckJson.extraCardId) order.push(deckJson.extraCardId);
  (deckJson.schemeIds||[]).forEach(id=>order.push(id));
  const counts = deckJson.deckCards || {};
  const mainIds = [...new Set([...(deckJson.deckOrder||[]).filter(id=> counts[id]), ...Object.keys(counts)])];
  mainIds.forEach(id=>{ for(let i=0;i<Number(counts[id]||0);i++) order.push(id); });
  const cardIds = order.slice().reverse();
  const id = newPieceId();
  const payload = {
    id, x:dropX, y:dropY,
    cardIds,
    // Remembered by every client (and saved with the table) so the deck can be
    // put back together later — see reformDeck.
    deckRecord: { id: 'deck-' + randomId(8), name: deckJson.name || 'Deck', owner: state.playerId, order },
    faceStates: cardIds.map(()=>false), // face-down by default
    owner: state.playerId,
    sourceSheets: deckJson.sourceSheets, // so OTHER clients can also resolve these cards when this event syncs to them
  };
  doAction('PLACE_PIECE', payload);
  setUndo(()=> doAction('REMOVE_PIECE', {id}));
  toast(`Imported "${deckJson.name||'deck'}" — ${cardIds.length} cards, in deck order.`);
}

/* =========================================================================
   BOARD RENDERING — pan/zoom via CSS transform on #boardWorld; bounds are
   dynamic (computed from piece positions + padding), never a hard limit.
   ========================================================================= */
function applyView(){
  const world = document.getElementById('boardWorld');
  world.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`;
  // Labels, counts and badges stay the same size on screen at any zoom: they
  // multiply by --inv-zoom to cancel the board's own scale (see .pov etc.).
  world.style.setProperty('--zoom', state.view.scale);
  world.style.setProperty('--inv-zoom', 1/state.view.scale);
  syncGridBackground();
  fitAllZoneLabels(); // zone labels shrink/hide to fit the zone at this zoom
}
// Rotation is a SEPARATE outer layer (#boardRotate) around the already-panned/zoomed
// content, pivoting on the viewport's own visual center — this avoids needing to
// recompute a moving pivot point every time the user pans or zooms.
let rotationSettleTimer = null;
function applyRotation(){
  const el = document.getElementById('boardRotate');
  el.style.transform = `rotate(${state.viewRotation}deg)`;
  // Labels, badges, attached tokens and resize cursors are all placed relative
  // to the VIEWER (see placePieceBadges/renderZones), and every piece's own
  // --counter-rotate includes the board angle — so they're all recomputed for
  // the new angle. Deferred until the board's .35s turn animation (see
  // #boardRotate's CSS) finishes, so they ride along with the board and then
  // settle upright, rather than jumping to their final spots while the board
  // underneath them is still turning.
  clearTimeout(rotationSettleTimer);
  rotationSettleTimer = setTimeout(()=>{
    // Read by every descendant that counter-rotates (zone labels, tokens,
    // badges) — a CSS custom property inherits through their own transforms.
    el.style.setProperty('--counter-rotate', (-state.viewRotation) + 'deg');
    renderBoard();
  }, 360);
}
// Board and piece rotations are always exact multiples of 90°. Given a
// direction on SCREEN (sx, sy each -1/0/1 — e.g. 0,1 = toward the viewer, the
// bottom of the screen), this is the matching direction in the local,
// unrotated frame of something that appears rotated by `deg` on screen.
function screenDirToLocal(sx, sy, deg){
  const v = rotateVector(sx, sy, deg);
  return { x: Math.round(v.x), y: Math.round(v.y) };
}
// The point on `box` (local coords) lying in screen direction (sx, sy) from
// its center — an edge midpoint or a corner — pushed `pad` px further out.
function boxPointToward(box, deg, sx, sy, pad){
  const d = screenDirToLocal(sx, sy, deg);
  const len = Math.hypot(d.x, d.y) || 1;
  return { x: box.x + box.w/2 + d.x*box.w/2 + d.x/len*pad,
           y: box.y + box.h/2 + d.y*box.h/2 + d.y/len*pad };
}
function placeAtPoint(el, pt){ el.style.left = pt.x+'px'; el.style.top = pt.y+'px'; }
// Compass resize directions ('n','ne',…), turned by `deg` clockwise — which
// way a zone handle actually points on screen once the board is rotated.
function rotateCompass(dir, deg){
  const order = ['n','ne','e','se','s','sw','w','nw'];
  return order[((order.indexOf(dir) + Math.round(deg/45)) % 8 + 8) % 8];
}
function resizeCursorFor(screenDir){
  return {n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize', ne:'nesw-resize', sw:'nesw-resize', nw:'nwse-resize', se:'nwse-resize'}[screenDir];
}
const POV_LABEL_OFFSET = 16; // card edge → label center, in SCREEN px (applied via --pov-dy, so it holds at any zoom)
// Places a piece's label, lock badge and search badge relative to the VIEWER:
// the label centered just past the anchor card's edge nearest the viewer
// (or its far edge, if the splay fans out toward the viewer and would run
// into it), the lock on the anchor's viewer-top-right corner, the search
// badge past the whole fan's viewer-top edge. anchorBox/fanBox are in the
// piece element's own local coords; splayDir is the pile's fan direction
// (null if not splayed).
function placePieceBadges(el, p, anchorBox, fanBox, splayDir){
  const deg = (state.viewRotation||0) + effectivePieceRotation(p);
  let labelFar = false;
  const label = el.querySelector(':scope > .piece-label');
  if(label){
    const near = screenDirToLocal(0, 1, deg);
    const fan = {right:{x:1,y:0}, left:{x:-1,y:0}, down:{x:0,y:1}, up:{x:0,y:-1}}[splayDir];
    labelFar = !!fan && fan.x===near.x && fan.y===near.y;
    label.classList.add('pov');
    placeAtPoint(label, boxPointToward(anchorBox, deg, 0, labelFar ? -1 : 1, 0));
    label.style.setProperty('--pov-dy', (labelFar ? -POV_LABEL_OFFSET : POV_LABEL_OFFSET)+'px');
  }
  const lock = el.querySelector(':scope > .lock-badge');
  if(lock){ lock.classList.add('pov'); placeAtPoint(lock, boxPointToward(anchorBox, deg, 1, -1, 0)); }
  const badge = el.querySelector(':scope > .search-alert-badge');
  if(badge){ badge.classList.add('pov'); placeAtPoint(badge, boxPointToward(fanBox, deg, 0, -1, 0)); badge.style.setProperty('--pov-dy', -(POV_LABEL_OFFSET + (labelFar ? 22 : 0))+'px'); }
}
// Converts a screen-space drag delta into true (unrotated) board-space delta —
// needed for every drag interaction so dragging still feels natural regardless of
// the current view rotation (dragging "up" on screen moves things "up" as drawn,
// even though that might not be +y/-y in the underlying unrotated coordinates).
function rotateVector(dx, dy, deg){
  const rad = -deg * Math.PI/180;
  return { x: dx*Math.cos(rad) - dy*Math.sin(rad), y: dx*Math.sin(rad) + dy*Math.cos(rad) };
}
function screenDeltaToWorldDelta(dx, dy){
  const r = rotateVector(dx, dy, state.viewRotation);
  return { x: r.x/state.view.scale, y: r.y/state.view.scale };
}
document.getElementById('btnRotateView').addEventListener('click', ()=>{
  state.viewRotation = (state.viewRotation + 90) % 360;
  applyRotation();
});
// Snap to Grid uses the SAME grid Show Grid draws (state.gridSize) — it used
// to snap to a fixed 32px grid unrelated to the one on screen. Something
// smaller than a grid cell (a token, or a card on a big grid) snaps to the
// cell's center; anything bigger lines its edge up with the grid lines.
function snapCoord(v){ return state.snapToGrid ? Math.round(v/state.gridSize)*state.gridSize : v; }
function snapAxis(v, size){
  const g = state.gridSize;
  return size < g ? Math.floor((v + size/2)/g)*g + (g - size)/2 : Math.round(v/g)*g;
}
function snapPos(x, y, w, h){
  return state.snapToGrid ? { x: snapAxis(x, w), y: snapAxis(y, h) } : { x, y };
}
document.getElementById('snapToGridCheckbox').addEventListener('change', (e)=>{ state.snapToGrid = e.target.checked; });
// "Grid ▾" — show grid, snap to grid, and cell size (shared by both).
document.getElementById('btnGridMenu').addEventListener('click', (e)=>{
  e.stopPropagation();
  const menu = document.getElementById('gridMenu');
  const willShow = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  if(willShow) positionMenuNear(menu, document.getElementById('btnGridMenu'));
});
document.addEventListener('click', (e)=>{ if(!e.target.closest('#gridMenu') && !e.target.closest('#btnGridMenu')) document.getElementById('gridMenu').classList.add('hidden'); });

