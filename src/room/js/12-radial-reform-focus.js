/* =========================================================================
   RADIAL MENU — the one discoverable place for every per-piece/per-token
   action, laid out as a ring of icon buttons centered on the right-click (or
   long-press) point instead of a linear dropdown list.
   ========================================================================= */
// Generic: lays out a ring of icon buttons ({icon,label,action}) centered at
// (clientX, clientY), clamped so the whole ring stays on-screen. Choosing an
// item runs its action but leaves the menu open (so you can fire off several
// actions in a row, e.g. Rotate 90 a few times, without reopening it) — it
// closes only when you click anywhere outside the ring; there's no separate
// cancel button since a click elsewhere already does that job.
// `itemsSource` may be a plain array, or a function returning a fresh array
// each time (re-run after every action so things like a Lock/Unlock label or
// Splay/Unsplay toggle stay accurate); a function that returns null/empty
// means the thing the menu was about is gone, so the menu closes itself.
// An item is normally {icon,label,action}, optionally with group:'stack' for
// the accent-tinted styling (see .radial-item.stack-action) that visually
// sets a pile-wide action apart from an ordinary single-card one. An item
// can instead be {divider:true} — a small non-interactive dot that still
// claims its own slot in the ring, so items on either side of it read as two
// separate clusters instead of one continuous loop (see openPieceRadialMenu,
// which brackets its stack-action group with one on each side).
// An item may also carry an explicit `angle` (radians, same 12-o'clock-is-
// zero/clockwise convention as the default placement below) to pin it to a
// specific spot instead of taking its turn in the even (i/n) spacing — see
// openTokenRadialMenu, which needs its positive/negative increments to land
// in the top/bottom HALVES specifically (something the plain even-spacing-
// by-index formula can't express: that formula only ever splits a ring into
// left/right halves by index, never top/bottom).
function openRadialMenu(itemsSource, clientX, clientY){
  const getItems = typeof itemsSource==='function' ? itemsSource : ()=>itemsSource;
  const menu = document.getElementById('radialMenu');
  function render(){
    const items = getItems();
    if(!items || !items.length){ closeRadialMenu(); return; }
    const n = items.length;
    const radius = Math.min(160, 78 + n*7);
    menu.innerHTML = items.map((it,i)=>{
      const angle = it.angle!=null ? it.angle : (i/n)*Math.PI*2 - Math.PI/2; // start at 12 o'clock, clockwise (unless pinned — see the comment above)
      const x = Math.round(Math.cos(angle)*radius), y = Math.round(Math.sin(angle)*radius);
      if(it.divider){
        return `<div class="radial-divider" style="left:${x}px;top:${y}px;"></div>`;
      }
      const cls = 'radial-item' + (it.group==='stack' ? ' stack-action' : '');
      return `<div class="${cls}" data-i="${i}" style="left:${x}px;top:${y}px;">
        <span class="radial-icon">${it.icon||'•'}</span><span class="radial-label">${escapeHtml(it.label)}</span>
      </div>`;
    }).join('');
    const vw = window.innerWidth, vh = window.innerHeight;
    const pad = radius + 44;
    const cx = Math.min(Math.max(clientX, pad), vw-pad);
    const cy = Math.min(Math.max(clientY, pad), vh-pad);
    menu.style.left = cx+'px';
    menu.style.top = cy+'px';
    menu.classList.remove('hidden');
    // .radial-divider slots are deliberately excluded by this selector — no
    // action to run, so no listener to attach.
    [...menu.querySelectorAll('.radial-item')].forEach(el=>{
      el.addEventListener('click', (e)=>{
        e.stopPropagation();
        items[Number(el.dataset.i)].action();
        render(); // stays open, redrawn with any updated labels/icons — or closes itself if the item is now gone
      });
    });
  }
  render();
}
function closeRadialMenu(){
  const menu = document.getElementById('radialMenu');
  menu.classList.add('hidden');
  menu.innerHTML = '';
}
document.addEventListener('click', (e)=>{ if(!e.target.closest('#radialMenu')) closeRadialMenu(); });
// Cards stop their own click events (see wirePressDragClick), so the listener
// above never sees a left-click that flips a card — close on any left-press
// outside the menu too, in capture phase so nothing can swallow it first.
document.addEventListener('mousedown', (e)=>{ if(e.button===0 && !e.target.closest('#radialMenu')) closeRadialMenu(); }, true);

// Right-click on empty board space. Each item closes the ring (openRadialMenu
// normally redraws after an action) and acts at the spot that was clicked.
function openBoardRadialMenu(clientX, clientY){
  let done = false;
  const act = (fn)=> ()=>{ done = true; fn(); };
  const items = [
    {icon:'📥', label:'Import Deck', action:act(()=>{
      pendingDeckDropWorld = clientToWorld(clientX, clientY);
      document.getElementById('deckFileInput').click();
    })},
    {icon:'🔘', label:'Add Token', action:act(()=> openTokenTypeMenuAt(clientX, clientY))},
    // Only on a table whose board came from a game (board link or "Send deck
    // to room") — that's how the room knows whose preconstructed decks to list.
    // Game-specific extra (see 12a-sealed-deck-private.js) — absent from a build without it.
    ...(typeof openSealedDeckMenuAt==='function' ? [{icon:'🎲', label:'Get Sealed Deck', action:act(()=> openSealedDeckMenuAt(clientX, clientY))}] : []),
    ...(state.gameFolderId ? [{icon:'📦', label:'Import Precon', action:act(()=> openPreconMenuAt(clientX, clientY))}] : []),
  ];
  openRadialMenu(()=> done ? null : items, clientX, clientY);
}
/* ---- Import Precon: the game's preconstructed decks (deck .json files in its
   game folder — see getPrecons in Code.gs; a player only sees decks whose
   cards they can access), listed fresh each time; picking one places it
   where you right-clicked, just like Import Deck. */
// dropWorld: where the deck goes (default: the clicked spot).
async function openPreconMenuAt(clientX, clientY, dropWorld){
  const menu = document.getElementById('tokenMenu');
  const drop = dropWorld || clientToWorld(clientX, clientY);
  tokenMenuAnchor = {x:clientX, y:clientY}; tokenPlaceAtWorld = null;
  menu.innerHTML = `<div class="token-swap-title">Preconstructed decks</div><div class="token-type-item" style="cursor:default;color:var(--text-soft);">Loading…</div>`;
  menu.classList.remove('hidden');
  positionMenuNear(menu, tokenMenuAnchorEl());
  let res;
  try{ res = await fetchGameBoards(state.gameFolderId); }
  catch(err){ res = { ok:false, error: err.message }; }
  if(menu.classList.contains('hidden')) return; // closed while loading
  const decks = (res && res.ok && res.decks) || [];
  if(!decks.length){
    menu.innerHTML = `<div class="token-swap-title">Preconstructed decks</div><div class="token-type-item" style="cursor:default;color:var(--text-soft);">${escapeHtml(res && !res.ok ? 'Could not load them: ' + (res.error||'') : 'This game has no preconstructed decks yet.')}</div>`;
    positionMenuNear(menu, tokenMenuAnchorEl());
    return;
  }
  menu.innerHTML = `<div class="token-swap-title">Preconstructed decks</div>` + decks.map((p,i)=>
    `<div class="token-type-item" data-precon="${i}">📦 ${escapeHtml(p.name)} <span style="margin-left:auto;font-size:11px;color:var(--text-soft);">${escapeHtml(p.deck.deckType||'')}</span></div>`).join('');
  menu.querySelectorAll('[data-precon]').forEach(el=> el.addEventListener('click', async (e)=>{
    e.stopPropagation();
    menu.classList.add('hidden');
    const p = decks[Number(el.dataset.precon)];
    const at = snapPos(drop.x - PIECE_W/2, drop.y - PIECE_H/2, PIECE_W, PIECE_H); // centered on the click
    try{ await importDeckJson({...p.deck, name: p.name}, at.x, at.y); }
    catch(err){ toast(`Could not import "${p.name}": ${err.message}`); }
  }));
  positionMenuNear(menu, tokenMenuAnchorEl());
}
function closeImageScalePopover(){ document.getElementById('imageScalePopover').classList.add('hidden'); }
document.addEventListener('click', (e)=>{
  if(e.target.closest('#imageScalePopover') || e.target.closest('.radial-item')) return;
  closeImageScalePopover();
});

// The 5 actions that apply to exactly ONE card — Flip/Peek/Draw/Rotate/Remove,
// all scoped to `cardIndex` specifically (not "the pile" in any sense). Used
// standalone for a genuinely single-card piece or any card picked out of a
// splay, and as the first half of the combined stack menu below.
/* =========================================================================
   REFORM DECK — puts an imported deck back together: every card of it on
   the board (any pile, any tab) and in YOUR hand comes back into one
   face-down pile in the deck's original order, where its original pile is
   (or else where you right-clicked). Other players' hands are private, so
   their cards stay put. Cards are matched by card id, so if two decks on
   the table share a card, whichever copies are found first are taken.
   Synced with the ordinary pile events (quietly), plus one summary note.
   ========================================================================= */
function deckRecordForCard(cardId){
  if(!cardId) return null;
  let found = null;
  for(const r of state.deckRecords.values()){
    if(!r.order || !r.order.includes(cardId)) continue;
    if(r.owner===state.playerId) return r; // your own deck first
    found = found || r;
  }
  return found;
}
function deckRecordForPile(p){
  for(const r of state.deckRecords.values()) if(r.pieceId===p.id) return r; // the deck's own pile
  for(let i=p.cardIds.length-1; i>=0; i--){ const r = deckRecordForCard(p.cardIds[i]); if(r) return r; }
  return null;
}
function doQuietAction(type, payload){ // synced and applied, but no history bubble/row of its own
  payload = {...payload, quiet:true};
  applyRoomEvent(type, payload);
  postRoomEvent(type, payload);
}
function reformDeck(recordId, clickedPieceId){
  const rec = state.deckRecords.get(recordId); if(!rec) return;
  const need = new Map();
  rec.order.forEach(id=> need.set(id, (need.get(id)||0) + 1));
  const take = (id)=>{ const n = need.get(id)||0; if(n<=0) return false; need.set(id, n-1); return true; };
  // Where it goes back together: its own pile if that's still on the table.
  const home = state.pieces.get(rec.pieceId) || state.pieces.get(clickedPieceId);
  if(!home) return;
  const dest = { x:home.x, y:home.y, tab:home.tab||'main' };
  // Collect from piles — its own pile first, then the rest.
  const piles = [...state.pieces.values()].filter(p=> p.kind!=='image' && p.cardIds && p.cardIds.length)
    .sort((a,b)=> (b.id===rec.pieceId) - (a.id===rec.pieceId));
  const changes = []; // {before (clone), keepIdx:[...]}
  let collected = 0;
  piles.forEach(p=>{
    const keepIdx = [];
    p.cardIds.forEach((cid, i)=>{ if(take(cid)) collected++; else keepIdx.push(i); });
    if(keepIdx.length !== p.cardIds.length) changes.push({ before: JSON.parse(JSON.stringify(p)), keepIdx });
  });
  // ...then your own hand.
  const handBefore = state.hand.slice();
  const handAfter = [];
  let fromHand = 0;
  state.hand.forEach(cid=>{ if(take(cid)){ collected++; fromHand++; } else handAfter.push(cid); });
  const missing = [...need.values()].reduce((a,b)=>a+b, 0);
  // Rebuild the deck from its original list, leaving out cards not found.
  const short = new Map(need);
  const order = rec.order.filter(cid=>{ const n = short.get(cid)||0; if(n>0){ short.set(cid, n-1); return false; } return true; });
  if(!order.length){ toast(`None of "${rec.name}"'s cards are on the table or in your hand.`); return; }
  // Apply: shrink/remove the piles cards came from, then place the reformed deck.
  changes.forEach(({before, keepIdx})=>{
    if(!keepIdx.length) doQuietAction('REMOVE_PIECE', {id:before.id});
    else doQuietAction('RESTORE_PIECE_CARDS', { id:before.id,
      cardIds: keepIdx.map(i=> before.cardIds[i]), faceStates: keepIdx.map(i=> before.faceStates[i]),
      cardRotations: keepIdx.map(i=> (before.cardRotations||[])[i]||0) });
  });
  if(fromHand){ state.hand = handAfter; renderHand(); }
  const newId = newPieceId();
  const cardIds = order.slice().reverse(); // first card on top
  doQuietAction('PLACE_PIECE', { id:newId, x:dest.x, y:dest.y, tab:dest.tab, cardIds, faceStates: cardIds.map(()=>false), owner: rec.owner,
    deckRecord: { id:rec.id, name:rec.name, owner:rec.owner, order:rec.order } });
  if(fromHand) syncHandCount();
  doNote(`reformed the deck "${rec.name}" (${order.length} card${order.length===1?'':'s'})${missing ? ` — ${missing} weren't on the table` : ''}`);
  toast(missing ? `Reformed "${rec.name}" — ${missing} card${missing===1?'':'s'} weren't on the table or in your hand.` : `Reformed "${rec.name}".`);
  renderBoard();
  setUndo(()=>{
    doQuietAction('REMOVE_PIECE', {id:newId});
    changes.forEach(({before})=>{
      if(state.pieces.has(before.id)){
        doQuietAction('RESTORE_PIECE_CARDS', { id:before.id, cardIds:before.cardIds, faceStates:before.faceStates, cardRotations:before.cardRotations });
      } else {
        doQuietAction('PLACE_PIECE', { ...before, ...(before.id===rec.pieceId ? {deckRecord:{ id:rec.id, name:rec.name, owner:rec.owner, order:rec.order }} : {}) });
        if(before.splayed) doQuietAction('SET_SPLAY', { id:before.id, splayed:true, dir:before.splayDir, spacing:before.splaySpacing });
      }
    });
    if(fromHand){ state.hand = handBefore; renderHand(); syncHandCount(); }
    doNote(`undid reforming the deck "${rec.name}"`);
    renderBoard();
  });
}
function singleCardMenuItems(p, cardIndex){
  const rec = deckRecordForCard(p.cardIds[cardIndex]);
  return [
    {icon:'⟲', label:'Flip', action:()=>flipTopCard(p.id, cardIndex)},
    {icon:'✋', label:'Draw', action:()=>drawTopCard(p.id, 'hand', cardIndex)},
    {icon:'↻', label:'Rotate', action:()=>rotateCardAt(p.id, cardIndex, 1)},
    {icon:'🗑', label:'Remove', action:()=>removeCard(p.id, cardIndex)},
    ...(rec ? [{icon:'📚', label:'Reform Deck', action:()=>reformDeck(rec.id, p.id)}] : []),
  ];
}
// Two different menus, depending on WHAT was actually clicked — no more
// single combined menu mixing both scopes into one overloaded ring:
//
// - Any individual card — a genuinely standalone single-card piece, ANY one
//   card picked out of a splay (the anchor included), OR the top card's own
//   face on an UNSPLAYED pile clicked directly (see wireStackInteraction,
//   which now always passes the top index as `cardIndex` rather than leaving
//   it null) — gets just the 5 single-card actions above, scoped to that one
//   card. A genuinely standalone lone card (no stack to speak of at all)
//   also gets a Lock/Unlock — there's no separate "stack handle" it could
//   ever reach a stack-wide Lock option through, and pinning a single card
//   in place is still a reasonable thing to want. It does NOT get a Label,
//   though — that one's pile-flavored enough (labeling a specific card
//   within a stack wouldn't make much sense either) that it stays exclusive
//   to the Stack menu below.
// - The STACK itself — reached ONLY through its "move whole stack" label
//   handle clicked without dragging it (see wireGroupHandleDrag), never
//   through the card face anymore — gets just the pile-wide actions
//   (Flip/Shuffle/Rotate/Label/Search/Lock/Remove), no per-card items mixed
//   in, since the label represents the pile as a whole rather than any one
//   card. "Stack" is dropped from every label here — the whole ring is
//   already, by construction, stack-scoped, so repeating it on every item
//   would just be noise. Rotate reuses the exact same whole-piece rotation
//   rotateCardAt already does for cardIndex===null (see its own comment).
function openPieceRadialMenu(pieceId, clientX, clientY, cardIndex){
  openRadialMenu(()=>{
    const p = state.pieces.get(pieceId); if(!p) return null;
    if(p.kind==='image'){
      // A custom-image piece isn't a card pile — no flip/splay/shuffle/search/draw,
      // just the things that still make sense for an arbitrary picture on the board.
      return [
        {icon:'⤢', label:'Scale', action:()=>openImageScalePopover(pieceId, clientX, clientY)},
        {icon:'🏷', label: p.label?'Rename':'Label', action:()=>setPieceLabel(pieceId)},
        {icon: p.locked?'🔓':'🔒', label: p.locked?'Unlock':'Lock', action:()=>togglePieceLock(pieceId)},
        {icon:'🗑', label:'Remove', action:()=>doAction('REMOVE_PIECE', {id:pieceId})},
      ];
    }
    const isStack = p.cardIds.length>1;
    const targetIndex = cardIndex!=null ? cardIndex : p.cardIds.length-1; // default: the top/anchor card
    const cardItems = singleCardMenuItems(p, targetIndex);
    if(cardIndex!=null) return cardItems; // one specific card — a splay pick, or the stack's own top card face
    if(!isStack){
      // A genuinely standalone lone card — see the doc comment above for why
      // Lock (but not Label) still gets tacked on here.
      return [...cardItems, {icon: p.locked?'🔓':'🔒', label: p.locked?'Unlock':'Lock', action:()=>togglePieceLock(pieceId)}];
    }
    // Only reachable via the label handle now (see the doc comment above) —
    // stack-wide actions only, none of the per-card items.
    return [
      {icon:'🔃', label:'Flip', group:'stack', action:()=>flipStack(pieceId)},
      {icon:'🔀', label:'Shuffle', group:'stack', action:()=>shufflePiece(pieceId)},
      {icon:'↻', label:'Rotate', group:'stack', action:()=>rotateCardAt(pieceId, null, 1)},
      // "Collapse" is just commitSplay(...,false,...) — i.e. exactly what
      // dragging a splay's edge back to the anchor already does — surfaced
      // as a menu item so a player doesn't have to know that dragging is how
      // you undo a splay, or fight with a fiddly drag to get it exactly
      // right. Only shown for a pile that's actually splayed right now; "un-
      // splay" is deliberately never said in the UI (per the ask), only
      // "Collapse".
      ...(p.splayed ? [{icon:'⬇', label:'Collapse', group:'stack', action:()=>commitSplay(pieceId, false, p.splayDir, p.splaySpacing, { splayed:p.splayed, dir:p.splayDir, spacing:p.splaySpacing })}] : []),
      {icon:'🏷', label: p.label?'Rename':'Label', group:'stack', action:()=>setPieceLabel(pieceId)},
      {icon:'🔍', label:'Search', group:'stack', action:()=>openSearchModal(pieceId)},
      {icon: p.locked?'🔓':'🔒', label: p.locked?'Unlock':'Lock', group:'stack', action:()=>togglePieceLock(pieceId)},
      {icon:'🗑', label:'Remove', group:'stack', action:()=>doAction('REMOVE_PIECE', {id:pieceId})},
      ...(()=>{ const rec = deckRecordForPile(p); return rec ? [{icon:'📚', label:'Reform Deck', group:'stack', action:()=>reformDeck(rec.id, pieceId)}] : []; })(),
    ];
  }, clientX, clientY);
}
// Scale popover for a custom-image piece — aspect ratio is always locked to the
// image's own natural proportions, same preview/commit-with-undo pattern as splay
// spacing and zone stroke width.
function openImageScalePopover(pieceId, clientX, clientY){
  const p = state.pieces.get(pieceId); if(!p || p.kind!=='image') return;
  const old = { w:p.w, h:p.h };
  const aspect = (p.naturalH && p.naturalW) ? p.naturalH/p.naturalW : (p.h/p.w);
  const el = document.getElementById('imageScalePopover');
  el.innerHTML = `
    <div class="splay-title">Scale</div>
    <input type="range" id="imageScaleSlider" min="20" max="800" step="4" value="${p.w}" style="width:calc(100% - 20px);margin:10px 10px 4px;">
    <div style="font-size:11px;color:var(--text-soft);margin:0 10px 10px;text-align:center;" id="imageScaleReadout">${Math.round(p.w)}×${Math.round(p.h)}px</div>
  `;
  const slider = document.getElementById('imageScaleSlider');
  function apply(w, commit){
    const h = Math.round(w*aspect);
    const pp = state.pieces.get(pieceId); if(!pp) return;
    pp.w = w; pp.h = h;
    document.getElementById('imageScaleReadout').textContent = `${Math.round(w)}×${h}px`;
    if(commit){ doAction('SET_PIECE_SCALE', {id:pieceId, w, h}); setUndo(()=> doAction('SET_PIECE_SCALE', {id:pieceId, w:old.w, h:old.h})); }
    else renderBoard();
  }
  slider.addEventListener('input', (e)=> apply(Number(e.target.value), false));
  slider.addEventListener('change', (e)=> apply(Number(e.target.value), true));
  const vw = window.innerWidth, vh = window.innerHeight;
  el.style.left = Math.min(clientX, vw-200)+'px';
  el.style.top = Math.min(clientY, vh-120)+'px';
  el.classList.remove('hidden');
}
function setPieceLabel(pieceId){
  const p = state.pieces.get(pieceId); if(!p) return;
  const label = prompt('Label for this pile:', p.label||'');
  if(label===null) return;
  const old = p.label;
  doAction('SET_LABEL', {id:pieceId, label:label.trim()});
  setUndo(()=> doAction('SET_LABEL', {id:pieceId, label:old}));
}

/* =========================================================================
   FOCUS ON CARD — jumps the view to any labeled pile.
   ========================================================================= */
function focusOnPiece(pieceId){
  const p = state.pieces.get(pieceId); if(!p) return;
  if(!onCurrentTab(p)) switchTab(p.tab||'main'); // it's on another tab — go there first
  const vp = document.getElementById('boardViewport');
  if(state.view.scale<0.3) state.view.scale = 0.6; // pull out of "see everything" scale into something legible
  const cx = p.x + pieceW(p)/2, cy = p.y + pieceH(p)/2;
  state.view.x = vp.clientWidth/2 - cx*state.view.scale;
  state.view.y = vp.clientHeight/2 - cy*state.view.scale;
  applyView();
}
document.getElementById('btnFocus').addEventListener('click', (e)=>{
  e.stopPropagation();
  const menu = document.getElementById('focusMenu');
  const labeled = [...state.pieces.values()].filter(p=>p.label);
  menu.innerHTML = labeled.length
    ? labeled.map(p=>`<div class="focus-item" data-id="${p.id}">${escapeHtml(p.label)}${state.tabs.length>1 && !onCurrentTab(p) ? ` <span style="color:var(--text-soft);font-size:11px;">· ${escapeHtml(tabName(p.tab||'main'))}</span>` : ''}</div>`).join('')
    : `<div class="focus-item" style="color:var(--text-soft);cursor:default;">No labeled piles yet</div>`;
  menu.querySelectorAll('[data-id]').forEach(el=> el.addEventListener('click', ()=>{ focusOnPiece(el.dataset.id); menu.classList.add('hidden'); }));
  const willShow = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  if(willShow) positionMenuNear(menu, document.getElementById('btnFocus'));
});
document.addEventListener('click', (e)=>{ if(!e.target.closest('#focusMenu') && !e.target.closest('#btnFocus')) document.getElementById('focusMenu').classList.add('hidden'); });

/* =========================================================================
   PUBLIC HAND COUNTERS — hand size is the one genuinely public, well-defined
   number available without a "deck"/"discard" zone concept in this freeform
   design; "cards on the board" per player is shown too, computed live from
   state.pieces (already synced) rather than needing its own event.
   ========================================================================= */
// `tokenNote` (optional) is what the table is told when tokens (not cards)
// went into or out of the hand, e.g. "put 3 Gold tokens in hand".
function syncHandCount(tokenNote){
  const payload = { playerId: state.playerId, playerName: state.playerName, count: state.hand.length,
    tokens: Object.fromEntries(state.handTokens) };
  if(tokenNote) payload.tokenNote = tokenNote;
  doAction('HAND_COUNT', payload);
}
// One chip per player under the chat: "✋ 5 Seth", you first, with the
// active player's chip highlighted once turns have started (see passTurn).
function renderPlayerCounters(){
  const el = document.getElementById('playerCounters');
  if(!el) return;
  const known = new Map(state.playerHandCounts);
  known.set(state.playerId, {playerName: state.playerName, count: state.hand.length, tokens: Object.fromEntries(state.handTokens)}); // your own count is always live, never waits on an echo
  state.players.forEach((name, pid)=>{ if(!known.has(pid)) known.set(pid, {playerName: name, count: null}); });
  const activeId = (state.turnIndex>=0 && state.turnOrder.length) ? state.turnOrder[state.turnIndex] : null;
  const order = [state.playerId, ...[...known.keys()].filter(pid=>pid!==state.playerId)];
  el.innerHTML = order.filter(pid=>known.get(pid) && known.get(pid).playerName).map(pid=>{
    const info = known.get(pid);
    const active = pid===activeId;
    const tokens = Object.entries(info.tokens||{}).filter(([,n])=>n>0);
    const tokenHtml = tokens.map(([type,n])=>`${tokenFaceMarkup(type, 'chip-token')}${n}`).join('');
    const tokenTitle = tokens.map(([type,n])=>` · ${n} ${type}`).join('');
    return `<span class="player-chip${active?' active-turn':''}" title="${active?'Their turn · ':''}${info.count==null?'Hand size not known yet':info.count+' card'+(info.count===1?'':'s')+' in hand'}${escapeHtml(tokenTitle)}">${active?'▶ ':''}✋ ${info.count==null?'?':info.count}${tokenHtml} <b>${escapeHtml(info.playerName)}</b></span>`;
  }).join('');
}

