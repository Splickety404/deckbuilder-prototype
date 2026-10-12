/* =========================================================================
   ZONES — colored/labeled/stroked board regions, optionally snapping pieces
   and tokens inside or outside their bounds. Created from the board's
   right-click menu ("Add Zone"); right-clicking a zone opens its own editor
   (style popover + move/resize handles), which closes on the next click
   elsewhere — otherwise a zone stays out of the way of ordinary play.
   ========================================================================= */
// Converts a point in CLIENT (screen) space into the coordinate frame #boardWorld's
// own pan/zoom transform operates in. #boardRotate wraps #boardWorld and rotates
// around the viewport's own visual center (see applyRotation/CSS) — an OUTER layer
// around the already-panned/zoomed content — so a screen point has to have that
// rotation undone FIRST, before the pan/zoom math below even applies. Skipping that
// step (treating client coords as if they mapped straight through the pan/zoom alone)
// only happens to be correct at viewRotation===0; at any other rotation, panning,
// drag-from-a-point, and zoom-to-cursor all land on the wrong spot. rotateVector
// already does exactly this "undo the rotation" transform for drag deltas, and works
// just as well on a point expressed as an offset from the rotation's own pivot.
function clientToWorld(clientX, clientY){
  const vp = document.getElementById('boardViewport');
  const rect = vp.getBoundingClientRect();
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  const rel = rotateVector(clientX-cx, clientY-cy, state.viewRotation);
  const ix = cx + rel.x, iy = cy + rel.y;
  return { x: (ix-rect.left - state.view.x)/state.view.scale, y: (iy-rect.top - state.view.y)/state.view.scale };
}
// Checks every zone with a snap mode and nudges (x,y) — the top-left of a box of size
// (w,h) whose CENTER is being tested for containment — into or out of that zone.
function applyZoneSnap(x, y, w, h){
  state.zones.forEach(z=>{
    if(!z.snapMode || z.snapMode==='none' || !onCurrentTab(z)) return;
    const cx = x+w/2, cy = y+h/2;
    const inside = cx>=z.x && cx<=z.x+z.w && cy>=z.y && cy<=z.y+z.h;
    if(!inside) return;
    if(z.snapMode==='inside'){
      x = Math.min(Math.max(x, z.x), z.x+z.w-w);
      y = Math.min(Math.max(y, z.y), z.y+z.h-h);
    } else if(z.snapMode==='outside'){
      const distLeft=cx-z.x, distRight=(z.x+z.w)-cx, distTop=cy-z.y, distBottom=(z.y+z.h)-cy;
      const minDist = Math.min(distLeft,distRight,distTop,distBottom);
      if(minDist===distLeft) x = z.x - w - 4;
      else if(minDist===distRight) x = z.x+z.w + 4;
      else if(minDist===distTop) y = z.y - h - 4;
      else y = z.y+z.h + 4;
    }
  });
  return {x,y};
}
const ZONE_DEFAULT_OPACITY = 0.28; // fill opacity for zones made before opacity was editable
// A zone's label shrinks to fit inside the zone as it appears on screen
// (labels are zoom-independent, so the room available changes with zoom and
// with which way the board is turned): from 11px down to 6pt (8px); if even
// that won't fit, the label is hidden. Re-run on every zoom (see applyView).
const ZONE_LABEL_MAX_PX = 11, ZONE_LABEL_MIN_PX = 8; // 8px = 6pt
const ZONE_LABEL_PAD_X = 20, ZONE_LABEL_INSET = 12; // the label's own side padding; its offset into the zone plus a little margin
let zoneLabelMeasure = null;
function zoneLabelTextWidth(text){ // at ZONE_LABEL_MAX_PX
  if(!zoneLabelMeasure){
    zoneLabelMeasure = document.createElement('canvas').getContext('2d');
    zoneLabelMeasure.font = `700 ${ZONE_LABEL_MAX_PX}px ${getComputedStyle(document.body).fontFamily}`;
  }
  return zoneLabelMeasure.measureText(text).width;
}
function fitZoneLabel(labelEl, z){
  const sideways = (state.viewRotation||0) % 180 !== 0;
  const scale = state.view.scale;
  const availW = (sideways ? z.h : z.w)*scale - ZONE_LABEL_INSET;
  const availH = (sideways ? z.w : z.h)*scale - 8;
  const textW = zoneLabelTextWidth(z.label || '');
  let px = ZONE_LABEL_MAX_PX;
  if(textW > 0) px = Math.min(px, (availW - ZONE_LABEL_PAD_X) / textW * ZONE_LABEL_MAX_PX); // width grows in step with the font size
  px = Math.min(px, (availH - 4) / 1.25); // and the label's height (line + padding) has to fit too
  px = Math.floor(px*10)/10;
  if(!(px >= ZONE_LABEL_MIN_PX)){ labelEl.style.display = 'none'; return; }
  labelEl.style.display = '';
  labelEl.style.fontSize = px + 'px';
}
function fitAllZoneLabels(){
  document.querySelectorAll('#boardWorld .zone > .zone-label').forEach(el=>{
    const z = state.zones.get(el.parentElement.dataset.id);
    if(z) fitZoneLabel(el, z);
  });
}
function renderZones(){
  const world = document.getElementById('boardWorld');
  state.zones.forEach(z=>{
    if(!onCurrentTab(z)) return; // another tab's zone
    const el = document.createElement('div');
    const editing = state.editingZoneId===z.id;
    el.className = 'zone' + (editing?' zone-editable':'');
    el.dataset.id = z.id;
    el.style.left=z.x+'px'; el.style.top=z.y+'px'; el.style.width=z.w+'px'; el.style.height=z.h+'px';
    el.style.background = hexToRgba(z.color||'#3d7dca', z.opacity!=null ? z.opacity : ZONE_DEFAULT_OPACITY);
    el.style.border = `${z.strokeWidth!=null?z.strokeWidth:2}px solid ${z.strokeColor||'#3d7dca'}`;
    el.innerHTML = (z.label ? `<div class="zone-label">${escapeHtml(z.label)}</div>` : '') + (z.locked ? `<div class="lock-badge">🔒</div>` : '');
    // Label in the zone's corner at the VIEWER's top-left (text upright — see
    // .zone-label's CSS), lock on the viewer's top-right, whichever way the
    // board is turned.
    const view = state.viewRotation||0, box = {x:0, y:0, w:z.w, h:z.h};
    const labelEl = el.querySelector('.zone-label');
    if(labelEl){
      placeAtPoint(labelEl, boxPointToward(box, view, -1, -1, 0));
      fitZoneLabel(labelEl, z);
    }
    const lockEl = el.querySelector('.lock-badge');
    if(lockEl){ lockEl.classList.add('pov'); placeAtPoint(lockEl, boxPointToward(box, view, 1, -1, 0)); }
    if(editing && !z.locked){
      // All 4 edges + all 4 corners (see wireZoneResize's own comment for how
      // each direction maps to which of x/y/w/h it actually adjusts) —
      // previously just the one bottom-right corner, which meant a zone
      // could never be resized from its top or left side, or from a single
      // edge alone, without first moving it to compensate.
      ['nw','n','ne','e','se','s','sw','w'].forEach(dir=>{
        const handle = document.createElement('div');
        handle.className = 'zone-handle ' + dir;
        handle.style.cursor = resizeCursorFor(rotateCompass(dir, state.viewRotation||0)); // the way this edge moves ON SCREEN
        el.appendChild(handle);
        wireZoneResize(handle, z, dir);
      });
    }
    wireZoneDrag(el, z);
    world.appendChild(el);
  });
}
// A zone is just background unless it's the one being edited: a left-press
// on it falls through to the board underneath (so left-drag box-selects and
// right-drag pans across zones like anywhere else). Right-click opens this
// zone's own editor — its style popover plus move/resize handles — which
// closes again as soon as you click anything else (see exitZoneEdit).
function wireZoneDrag(el, z){
  let startX, startY, canDrag=false, ghost=null;
  wirePressDragClick(el, {
    onDown: (e)=>{
      if(state.editingZoneId!==z.id) return false; // not being edited — let the press reach the board
      if(e.target.closest('.zone-handle')) return false; // the resize handle drags itself
      canDrag = !z.locked;
      startX = z.x; startY = z.y;
    },
    onMove: (dx, dy)=>{
      if(!canDrag) return;
      if(!ghost || !ghost.isConnected) ghost = createDragGhost(); // renderBoard (a flip/rotate, or anyone else's action) wipes it mid-drag
      const d = screenDeltaToWorldDelta(dx, dy);
      z.x = startX+d.x; z.y = startY+d.y;
      const liveEl = el.isConnected ? el : document.querySelector(`.zone[data-id="${z.id}"]`); // see driveWholePieceDrag on re-renders mid-drag
      if(liveEl){ liveEl.style.left=z.x+'px'; liveEl.style.top=z.y+'px'; }
      updateDragGhost(ghost, z.x, z.y, z.w, z.h);
    },
    onContext: (e)=> enterZoneEdit(z.id, e.clientX, e.clientY),
    onDrop: (dx, dy, ev)=>{
      removeDragGhost(ghost); ghost=null;
      if(!canDrag) return;
      const toTab = tabAtPoint(ev.clientX, ev.clientY);
      if(toTab){ z.x = startX; z.y = startY; exitZoneEdit(); moveObjectsToTab([{kind:'zone', id:z.id}], toTab); renderBoard(); return; }
      doAction('SET_ZONE_RECT', {id:z.id, x:z.x, y:z.y, w:z.w, h:z.h});
      setUndo(()=> doAction('SET_ZONE_RECT', {id:z.id, x:startX, y:startY, w:z.w, h:z.h}));
    },
  });
}
function enterZoneEdit(zoneId, clientX, clientY){
  if(!state.zones.has(zoneId)) return;
  state.editingZoneId = zoneId;
  renderBoard();
  openZoneEditPopover(zoneId, clientX, clientY);
}
function exitZoneEdit(){
  if(!state.editingZoneId) return;
  state.editingZoneId = null;
  closeZoneEditPopover();
  renderBoard();
}
// A new zone from a box drawn on the board (right-click while dragging a
// selection box — see beginBoxSelect), opened straight into its editor. A
// box too small to be deliberate still makes a usable, minimum-sized zone.
function addZoneFromRect(r, clientX, clientY){
  const x = snapCoord(r.x), y = snapCoord(r.y);
  const w = Math.max(40, snapCoord(r.x + r.w) - x), h = Math.max(40, snapCoord(r.y + r.h) - y);
  const zone = { id:newZoneId(), x, y, w, h,
    color:'#3d7dca', strokeColor:'#3d7dca', strokeWidth:2, label:'', snapMode:'none', locked:false, opacity:ZONE_DEFAULT_OPACITY };
  doAction('PLACE_ZONE', zone);
  setUndo(()=> doAction('REMOVE_ZONE', {id:zone.id}));
  enterZoneEdit(zone.id, clientX, clientY);
}
// `dir` is which edge(s)/corner this particular handle drags — any
// combination of 'n'/'s' (top/bottom) and 'e'/'w' (right/left). An 'e'/'s'
// component just grows/shrinks w/h from the OPPOSITE (fixed) side, same as
// the old bottom-right-only handle always did. An 'n'/'w' component instead
// has to move x/y too, by exactly however much w/h actually changed (not by
// the raw drag delta) — that's what keeps the FAR edge/corner fixed in place
// while the near one tracks the cursor, rather than the whole zone sliding
// along with the drag the way it would if only x/y moved and w/h didn't
// compensate. Same Math.max(40, …) minimum as before, now applied per-axis.
function wireZoneResize(handleEl, z, dir){
  handleEl.addEventListener('mousedown', (e)=>{
    if(e.button!==0) return; // right-drag pans, even starting on a handle
    e.stopPropagation();
    const startClientX=e.clientX, startClientY=e.clientY;
    const startX=z.x, startY=z.y, startW=z.w, startH=z.h;
    function onMove(ev){
      const d = screenDeltaToWorldDelta(ev.clientX-startClientX, ev.clientY-startClientY);
      let x=startX, y=startY, w=startW, h=startH;
      if(dir.includes('e')) w = Math.max(40, startW + d.x);
      if(dir.includes('s')) h = Math.max(40, startH + d.y);
      if(dir.includes('w')){ w = Math.max(40, startW - d.x); x = startX + (startW - w); }
      if(dir.includes('n')){ h = Math.max(40, startH - d.y); y = startY + (startH - h); }
      z.x=x; z.y=y; z.w=w; z.h=h;
      const zoneEl = handleEl.isConnected ? handleEl.closest('.zone') : document.querySelector(`.zone[data-id="${z.id}"]`);
      if(!zoneEl) return;
      zoneEl.style.left = z.x+'px'; zoneEl.style.top = z.y+'px';
      zoneEl.style.width = z.w+'px'; zoneEl.style.height = z.h+'px';
    }
    function onUp(){
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      doAction('SET_ZONE_RECT', {id:z.id, x:z.x, y:z.y, w:z.w, h:z.h});
      setUndo(()=> doAction('SET_ZONE_RECT', {id:z.id, x:startX, y:startY, w:startW, h:startH}));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
// A zone's "radial menu" IS this panel — right-clicking a zone opens it
// directly (see enterZoneEdit), with every action (style, snap, lock,
// delete) in one place rather than needing an Edit item in a pie menu first.
function openZoneEditPopover(zoneId, clientX, clientY){
  const z = state.zones.get(zoneId); if(!z) return;
  const opacityPct = Math.round((z.opacity!=null ? z.opacity : ZONE_DEFAULT_OPACITY)*100);
  const old = { label:z.label, color:z.color, strokeColor:z.strokeColor, strokeWidth:z.strokeWidth, snapMode:z.snapMode, opacity:opacityPct/100 };
  const el = document.getElementById('zonePopover');
  el.innerHTML = `
    <div class="popover-drag" title="Drag to move this panel">Edit zone <span class="grip">⋮⋮</span></div>
    <div class="popover-row"><label>Label</label><input type="text" id="zoneLabelInput" value="${escapeHtml(z.label||'')}" placeholder="(none)"></div>
    <div class="popover-row"><label>Fill color</label><input type="color" id="zoneColorInput" value="${z.color}"></div>
    <div class="popover-row"><label>Fill opacity</label><input type="range" id="zoneOpacityInput" min="0" max="100" step="5" value="${opacityPct}"></div>
    <div class="popover-row"><label>Stroke color</label><input type="color" id="zoneStrokeColorInput" value="${z.strokeColor}"></div>
    <div class="popover-row"><label>Stroke width</label><input type="range" id="zoneStrokeWidthInput" min="0" max="8" step="1" value="${z.strokeWidth}"></div>
    <div class="popover-row"><label>Snap</label>
      <select id="zoneSnapInput">
        <option value="none">None</option>
        <option value="inside">Objects snap inside</option>
        <option value="outside">Objects snap outside</option>
      </select>
    </div>
    <div class="popover-actions">
      <div class="btn btn-sm" id="btnZoneLock" style="flex:1;justify-content:center;">${z.locked?'🔓 Unlock':'🔒 Lock'}</div>
      <div class="btn btn-sm" id="btnZoneDelete" style="flex:1;justify-content:center;color:var(--danger);">Delete</div>
      <div class="btn btn-accent btn-sm" id="btnZoneDone" style="flex:1;justify-content:center;">Done</div>
    </div>
  `;
  document.getElementById('zoneSnapInput').value = z.snapMode||'none';
  function readForm(){
    return {
      label: document.getElementById('zoneLabelInput').value.trim(),
      color: document.getElementById('zoneColorInput').value,
      strokeColor: document.getElementById('zoneStrokeColorInput').value,
      strokeWidth: Number(document.getElementById('zoneStrokeWidthInput').value),
      snapMode: document.getElementById('zoneSnapInput').value,
      opacity: Number(document.getElementById('zoneOpacityInput').value)/100,
    };
  }
  function preview(){
    const zz = state.zones.get(zoneId); if(!zz) return;
    Object.assign(zz, readForm());
    renderBoard();
  }
  function commit(){
    doAction('SET_ZONE_STYLE', {id:zoneId, ...readForm()});
    setUndo(()=> doAction('SET_ZONE_STYLE', {id:zoneId, ...old}));
  }
  ['zoneColorInput','zoneOpacityInput','zoneStrokeColorInput','zoneStrokeWidthInput'].forEach(id=>{
    document.getElementById(id).addEventListener('input', preview);
    document.getElementById(id).addEventListener('change', commit);
  });
  document.getElementById('zoneLabelInput').addEventListener('input', preview);
  document.getElementById('zoneLabelInput').addEventListener('change', commit);
  document.getElementById('zoneSnapInput').addEventListener('change', ()=>{ preview(); commit(); });
  document.getElementById('btnZoneLock').addEventListener('click', (e)=>{
    toggleZoneLock(zoneId);
    const zz = state.zones.get(zoneId); if(!zz) return;
    e.target.textContent = zz.locked ? '🔓 Unlock' : '🔒 Lock';
  });
  document.getElementById('btnZoneDelete').addEventListener('click', ()=>{
    const clone = {...state.zones.get(zoneId)};
    doAction('REMOVE_ZONE', {id:zoneId});
    setUndo(()=> doAction('PLACE_ZONE', clone));
    exitZoneEdit();
  });
  document.getElementById('btnZoneDone').addEventListener('click', exitZoneEdit);
  el.classList.remove('hidden');
  placeZonePopover(el, zoneId);
  wirePopoverDrag(el, el.querySelector('.popover-drag'));
}
// Where the zone editor opens: wherever you last dragged it this session, or
// else beside the zone (right, then left, then below, then above) so it
// doesn't cover the zone you're editing; if the zone fills the screen, the
// screen corner farthest from its middle.
let zonePopoverUserPos = null;
function placeZonePopover(el, zoneId){
  const vw = window.innerWidth, vh = window.innerHeight, pad = 12;
  const pw = el.offsetWidth, ph = el.offsetHeight;
  const clampPos = (x, y)=>({ x: Math.max(8, Math.min(x, vw-pw-8)), y: Math.max(8, Math.min(y, vh-ph-8)) });
  let pos = zonePopoverUserPos ? clampPos(zonePopoverUserPos.x, zonePopoverUserPos.y) : null;
  const zEl = document.querySelector(`.zone[data-id="${zoneId}"]`);
  if(!pos && zEl){
    const z = zEl.getBoundingClientRect();
    const midY = Math.max(8, Math.min(z.top + z.height/2 - ph/2, vh-ph-8));
    const midX = Math.max(8, Math.min(z.left + z.width/2 - pw/2, vw-pw-8));
    const tries = [
      {x: z.right + pad, y: midY}, {x: z.left - pw - pad, y: midY},
      {x: midX, y: z.bottom + pad}, {x: midX, y: z.top - ph - pad},
    ];
    pos = tries.find(t=> t.x>=8 && t.y>=8 && t.x+pw<=vw-8 && t.y+ph<=vh-8);
    if(!pos){
      const cx = z.left + z.width/2, cy = z.top + z.height/2;
      pos = { x: cx < vw/2 ? vw-pw-8 : 8, y: cy < vh/2 ? vh-ph-8 : 8 };
    }
  }
  if(!pos) pos = clampPos(vw/2 - pw/2, vh/2 - ph/2);
  el.style.left = pos.x+'px'; el.style.top = pos.y+'px';
}
// Drag a fixed-position panel around by its header. The zone editor
// remembers where you left it (zonePopoverUserPos) for the rest of the session.
function wirePopoverDrag(panel, handle){
  if(!handle) return;
  handle.addEventListener('mousedown', (e)=>{
    if(e.button!==0 || e.target.closest('.btn')) return; // buttons in the header still just click
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const r = panel.getBoundingClientRect();
    // Pin it where it is now, in plain left/top terms (a panel may start out
    // centered with a transform, or anchored by bottom).
    panel.classList.add('moved');
    panel.style.left = r.left+'px'; panel.style.top = r.top+'px'; panel.style.bottom = 'auto';
    function move(ev){
      const x = Math.max(0, Math.min(r.left + ev.clientX - startX, window.innerWidth - r.width));
      const y = Math.max(0, Math.min(r.top + ev.clientY - startY, window.innerHeight - 30));
      panel.style.left = x+'px'; panel.style.top = y+'px';
      if(panel.id==='zonePopover') zonePopoverUserPos = {x, y};
    }
    function up(){ window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
function closeZoneEditPopover(){ document.getElementById('zonePopover').classList.add('hidden'); }
// The zone editor closes the instant you left-press anything other than that
// zone or its own popover. Capture phase, because pieces stop their own
// mousedown before it would ever bubble up to document. (Right-clicking
// something else closes it too — see dispatchContextClick — but right-DRAG
// panning deliberately doesn't, so you can pan while editing.)
document.addEventListener('mousedown', (e)=>{
  if(!state.editingZoneId || e.button!==0) return;
  const t = e.target;
  if(t.closest('#zonePopover')) return;
  const zoneEl = t.closest('.zone');
  if(zoneEl && zoneEl.dataset.id===state.editingZoneId) return;
  exitZoneEdit();
}, true);

