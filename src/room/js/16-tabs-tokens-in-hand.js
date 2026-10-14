/* =========================================================================
   TABS — a board can have several tabs. Everything on the board (piece,
   token, zone) belongs to one tab (`.tab`, default 'main') and only shows
   while you're viewing that tab. The list of tabs is shared; which tab you're
   looking at is just yours. Drag anything onto a tab's name to move it there.
   Click to switch, double-click to rename, right-click for rename/delete.
   ========================================================================= */
function onCurrentTab(o){ return ((o && o.tab) || 'main') === state.currentTab; }
function tabName(id){ const t = state.tabs.find(t=>t.id===id); return t ? t.name : 'Table'; }
function tabIsEmpty(id){
  const on = o=> (o.tab||'main')===id;
  return ![...state.pieces.values()].some(on) && ![...state.tokens.values()].some(on) && ![...state.zones.values()].some(on);
}
var renamingTabId = null; // var (hoisted): renderBoard, defined earlier, reads it via renderBoardTabs
function renderBoardTabs(){
  const bar = document.getElementById('boardTabs'); if(!bar) return;
  if(renamingTabId) return; // don't wipe the rename box mid-typing
  bar.innerHTML = state.tabs.map(t=>`<div class="board-tab${t.id===state.currentTab?' active':''}" data-tab="${escapeHtml(t.id)}" title="Click to view · double-click to rename · drag things here to move them">${escapeHtml(t.name)}</div>`).join('')
    + `<div class="board-tab board-tab-add" id="btnAddTab" title="Add a tab">+</div>`;
  bar.querySelectorAll('.board-tab[data-tab]').forEach(el=>{
    const id = el.dataset.tab;
    el.addEventListener('click', ()=> switchTab(id));
    el.addEventListener('dblclick', ()=> startRenameTab(id));
    el.addEventListener('contextmenu', (e)=>{
      e.preventDefault(); e.stopPropagation();
      openRadialMenu(()=> [
        {icon:'✎', label:'Rename', action:()=>{ closeRadialMenu(); startRenameTab(id); }},
        ...(id==='main' ? [] : [{icon:'🗑', label:'Delete', action:()=>{ closeRadialMenu(); deleteTab(id); }}]),
      ], e.clientX, e.clientY);
    });
  });
  document.getElementById('btnAddTab').addEventListener('click', addTab);
}
function switchTab(id){
  if(id===state.currentTab) return;
  state.currentTab = id;
  clearSelection(); exitZoneEdit(); closePileBrowser();
  renderBoard();
}
function addTab(){
  const id = 'tab-' + randomId(8);
  let n = state.tabs.length + 1, name = 'Tab ' + n;
  while(state.tabs.some(t=>t.name===name)) name = 'Tab ' + (++n);
  doAction('ADD_TAB', {id, name});
  setUndo(()=>{ if(tabIsEmpty(id)) doAction('REMOVE_TAB', {id}); });
  switchTab(id);
  startRenameTab(id);
}
function startRenameTab(id){
  const el = document.querySelector(`.board-tab[data-tab="${CSS.escape(id)}"]`); if(!el) return;
  const t = state.tabs.find(t=>t.id===id); if(!t) return;
  renamingTabId = id;
  el.innerHTML = `<input type="text" maxlength="30" value="${escapeHtml(t.name)}">`;
  const input = el.querySelector('input');
  input.focus(); input.select();
  const finish = (save)=>{
    if(renamingTabId!==id) return;
    renamingTabId = null;
    const name = input.value.trim();
    if(save && name && name!==t.name){ const oldName = t.name; doAction('RENAME_TAB', {id, name}); setUndo(()=> doAction('RENAME_TAB', {id, name:oldName})); }
    renderBoardTabs();
  };
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') finish(true); else if(e.key==='Escape') finish(false); e.stopPropagation(); });
  input.addEventListener('blur', ()=> finish(true));
  input.addEventListener('mousedown', e=> e.stopPropagation());
}
function deleteTab(id){
  if(id==='main') return;
  if(!tabIsEmpty(id)){ toast(`"${tabName(id)}" still has things on it — move or remove them first.`); return; }
  const t = state.tabs.find(t=>t.id===id); if(!t) return;
  doAction('REMOVE_TAB', {id});
  setUndo(()=> doAction('ADD_TAB', {id:t.id, name:t.name}));
}
// The OTHER tab (if any) under a screen point — where a drag is being dropped.
function tabAtPoint(x, y){
  const el = document.elementFromPoint(x, y);
  const tab = el && el.closest && el.closest('.board-tab[data-tab]');
  return tab && tab.dataset.tab!==state.currentTab ? tab.dataset.tab : null;
}
// Light up whichever tab a drag is hovering.
window.addEventListener('mousemove', (e)=>{
  const target = pointerDragging ? tabAtPoint(e.clientX, e.clientY) : null;
  document.querySelectorAll('.board-tab.drop-hover').forEach(el=>{ if(el.dataset.tab!==target) el.classList.remove('drop-hover'); });
  if(target){ const el = document.querySelector(`.board-tab[data-tab="${CSS.escape(target)}"]`); if(el) el.classList.add('drop-hover'); }
});
window.addEventListener('mouseup', ()=> document.querySelectorAll('.board-tab.drop-hover').forEach(el=>el.classList.remove('drop-hover')));
// Moves one or more objects ([{kind, id}]) to another tab, as one undo step.
function moveObjectsToTab(objs, tab){
  const olds = objs.map(o=>{
    const m = o.kind==='piece' ? state.pieces : o.kind==='token' ? state.tokens : state.zones;
    const obj = m.get(o.id);
    return obj ? {...o, tab:obj.tab||'main', attachedTo:obj.attachedTo, x:obj.x, y:obj.y} : null;
  }).filter(Boolean);
  if(!olds.length) return;
  olds.forEach(o=>{
    // A token riding a card leaves that card when it's sent to another tab.
    if(o.kind==='token' && o.attachedTo){
      const host = state.pieces.get(o.attachedTo);
      doAction('MOVE_TOKEN', {id:o.id, x:host ? host.x+PIECE_W-22 : o.x, y:host ? host.y-22 : o.y, attachedTo:null});
    }
    doAction('SET_TAB', {kind:o.kind, id:o.id, tab});
  });
  setUndo(()=> olds.forEach(o=>{
    doAction('SET_TAB', {kind:o.kind, id:o.id, tab:o.tab});
    if(o.kind==='token' && o.attachedTo) doAction('MOVE_TOKEN', {id:o.id, x:o.x, y:o.y, attachedTo:o.attachedTo});
  }));
  toast(`Moved to "${tabName(tab)}"`);
}

/* =========================================================================
   TOKENS IN HAND — drop a board token (a whole stack, or one peeled token)
   onto your hand and it goes into a small tray at the left of the hand area;
   drag one back out onto the board to play it. How many of each type every
   player holds is public, like hand size (see syncHandCount/renderPlayerCounters).
   ========================================================================= */
function renderHandTokens(){
  const el = document.getElementById('handTokens');
  if(!el) return;
  const entries = [...state.handTokens.entries()].filter(([,n])=>n>0);
  el.innerHTML = entries.map(([type,n])=>{
    return `<div class="hand-token" data-type="${escapeHtml(type)}" title="${escapeHtml(type)} — drag the token to play one">
      ${tokenFaceMarkup(type, 'dot')}<span class="qty" title="Drag to play all ${n}">×${n}</span></div>`;
  }).join('');
  // Same as a board token stack: grab the token itself for one, its quantity for the whole stack.
  el.querySelectorAll('.hand-token').forEach(chip=>{
    const type = chip.dataset.type;
    wireHandTokenDrag(chip.querySelector('.dot'), type, false);
    wireHandTokenDrag(chip.querySelector('.qty'), type, true);
    // Also like a board token: W/S and the scroll wheel while hovering, right-click for the ring.
    chip.addEventListener('mouseenter', ()=>{ hoveredHandTokenType = type; showTokenHotkeyHint(chip); });
    chip.addEventListener('mouseleave', ()=>{ if(hoveredHandTokenType===type){ hoveredHandTokenType = null; hideHotkeyHint(); endHandTokenRun(); } });
    chip.addEventListener('contextmenu', (e)=>{ e.preventDefault(); e.stopPropagation(); openHandTokenRadialMenu(type, e.clientX, e.clientY); });
    if(hoveredHandTokenType===type) showTokenHotkeyHint(chip); // re-anchor after a rebuild (the count just changed)
  });
}
/* ---- Tokens in hand: the same quick adjustments as on the board. A hand
   holds real tokens, so it never goes below zero (at zero the token leaves
   the hand). W/S/wheel changes sync live but quietly; one summary goes to
   the table when the cursor leaves ("changed Damage in hand from 3 to 5"),
   and one Undo reverts the run — same as board tokens (see hotkeyAdjustToken). */
let hoveredHandTokenType = null;
let handTokenRun = null; // {type, startCount}
function setHandTokenCount(type, count){
  if(count>0) state.handTokens.set(type, count); else state.handTokens.delete(type);
  renderHand();
}
function hotkeyAdjustHandToken(type, delta){
  const cur = state.handTokens.get(type)||0;
  if(!handTokenRun || handTokenRun.type!==type){ endHandTokenRun(); handTokenRun = {type, startCount:cur}; }
  const next = Math.max(0, cur+delta);
  if(next===cur) return;
  setHandTokenCount(type, next);
  doQuietAction('HAND_COUNT', { playerId: state.playerId, playerName: state.playerName, count: state.hand.length, tokens: Object.fromEntries(state.handTokens) });
  renderPlayerCounters();
}
function endHandTokenRun(){
  const run = handTokenRun; handTokenRun = null;
  if(!run) return;
  const now = state.handTokens.get(run.type)||0;
  if(now===run.startCount) return;
  syncHandCount(`changed ${run.type} in hand from ${run.startCount} to ${now}`);
  setUndo(()=>{ setHandTokenCount(run.type, run.startCount); syncHandCount(`changed ${run.type} in hand back to ${run.startCount}`); });
}
// One-shot change (ring items, Set Value): announced and undoable right away.
function changeHandToken(type, next){
  endHandTokenRun();
  const old = state.handTokens.get(type)||0;
  next = Math.max(0, Math.round(next));
  if(next===old) return;
  setHandTokenCount(type, next);
  syncHandCount(`changed ${type} in hand from ${old} to ${next}`);
  setUndo(()=>{ setHandTokenCount(type, old); syncHandCount(`changed ${type} in hand back to ${old}`); });
}
function swapHandTokenType(type, newType){
  endHandTokenRun();
  const n = state.handTokens.get(type)||0;
  if(!n || newType===type) return;
  const oldNew = state.handTokens.get(newType)||0;
  state.handTokens.delete(type);
  state.handTokens.set(newType, oldNew + n);
  renderHand();
  syncHandCount(`swapped ${n} ${type} in hand for ${newType}`);
  setUndo(()=>{
    state.handTokens.set(type, n);
    if(oldNew) state.handTokens.set(newType, oldNew); else state.handTokens.delete(newType);
    renderHand();
    syncHandCount(`undid swapping ${type} in hand`);
  });
}
function openHandTokenRadialMenu(type, clientX, clientY){
  let closed = false;
  openRadialMenu(()=>{
    if(closed) return null;
    const n = state.handTokens.get(type)||0; if(!n) return null;
    return [
      ...TOKEN_INCREMENTS.map((k,i)=>({icon:'+'+k, label:'+'+k, angle:tokenRadialAngle('top',i), action:()=> changeHandToken(type, n+k)})),
      ...TOKEN_INCREMENTS.map((k,i)=>({icon:'−'+k, label:'-'+k, angle:tokenRadialAngle('bottom',i), action:()=> changeHandToken(type, n-k)})),
      {icon:'✕', label:'Remove All', angle:0, action:()=> changeHandToken(type, 0)},
      {icon:'#', label:'Set Value', angle:Math.PI, action:()=>{ closed = true; showTokenValuePopover(type, n, clientX, clientY, v=> changeHandToken(type, v)); }},
      {icon:'✎', label:'Edit Token', angle:-0.45, action:()=>{ closed = true; tokenMenuAnchor = {x:clientX, y:clientY}; tokenPlaceAtWorld = null; openTokenTypeEditor(type); }},
      {icon:'⇄', label:'Swap Token', angle:0.45, action:()=>{ closed = true; showTokenSwapMenu(type, clientX, clientY, nt=> swapHandTokenType(type, nt)); }},
    ];
  }, clientX, clientY);
}
document.addEventListener('keydown', (e)=>{
  if(!hoveredHandTokenType || e.ctrlKey || e.metaKey || e.altKey) return;
  if(isTextEntryFocused()) return;
  if(/^[0-9]$/.test(e.key)){ // set the hand stack to that value (two digits typed quickly = two-digit number)
    e.preventDefault();
    const now = Date.now(), id = 'hand:'+hoveredHandTokenType;
    tokenDigitBuf = (tokenDigitId===id && now - tokenDigitAt < 900 && tokenDigitBuf.length<3) ? tokenDigitBuf + e.key : e.key;
    tokenDigitId = id; tokenDigitAt = now;
    hotkeyAdjustHandToken(hoveredHandTokenType, Number(tokenDigitBuf) - (state.handTokens.get(hoveredHandTokenType)||0));
    return;
  }
  const k = e.key.toLowerCase();
  const delta = k==='w' ? 1 : k==='s' ? -1 : 0;
  if(!delta) return;
  e.preventDefault();
  hotkeyAdjustHandToken(hoveredHandTokenType, delta);
});
const handTokenWheel = {acc:0, last:0, key:null};
document.getElementById('handTokens').addEventListener('wheel', (e)=>{
  const chip = e.target.closest && e.target.closest('.hand-token'); if(!chip) return;
  e.preventDefault(); e.stopPropagation();
  const delta = wheelSteps(handTokenWheel, chip.dataset.type, e);
  if(!delta) return;
  hoveredHandTokenType = chip.dataset.type;
  hotkeyAdjustHandToken(chip.dataset.type, delta);
}, {passive:false});
// A count change rebuilds the chip (no mouseleave from a removed element), so
// also end the hover the moment the cursor is over anything else.
window.addEventListener('mousemove', (e)=>{
  if(!hoveredHandTokenType) return;
  const chip = e.target && e.target.closest && e.target.closest('.hand-token');
  if(chip && chip.dataset.type===hoveredHandTokenType) return;
  hoveredHandTokenType = null; hideHotkeyHint(); endHandTokenRun();
});
// Puts `amount` tokens from a board token stack into the hand.
// From a stack at zero or below, one peeled token can still go in (the stack
// just counts further down, as with any peel).
function sendTokenToHand(tokenId, amount){
  const t = state.tokens.get(tokenId);
  if(!t || amount<=0 || (t.count>0 && t.count<amount) || (t.count<=0 && amount!==1)) return;
  const clone = JSON.parse(JSON.stringify(t));
  if(amount===t.count) doAction('REMOVE_TOKEN', {id:tokenId});
  else doAction('SET_TOKEN_COUNT', {id:tokenId, count:t.count-amount});
  state.handTokens.set(t.type, (state.handTokens.get(t.type)||0) + amount);
  renderHand();
  syncHandCount(`put ${amount} ${t.type} token${amount===1?'':'s'} in hand`);
  setUndo(()=>{
    state.handTokens.set(clone.type, Math.max(0, (state.handTokens.get(clone.type)||0) - amount));
    renderHand();
    syncHandCount(`took ${amount} ${clone.type} token${amount===1?'':'s'} back out of hand`);
    doAction('PLACE_TOKEN', clone);
  });
}
// While a board token is dragged: light up the hand when it's over it.
function tokenHandHover(ev){
  document.getElementById('hand-panel').classList.toggle('hand-drop-target', isOverHandPanel(ev.clientX, ev.clientY));
}
function clearTokenHandHover(){ document.getElementById('hand-panel').classList.remove('hand-drop-target'); }
// Drag a token out of the hand onto the board — the token itself plays ONE,
// its "×N" quantity plays the whole stack (`all`) — joining a same-type stack
// if dropped on one.
function wireHandTokenDrag(chip, type, all){
  chip.addEventListener('mousedown', (e)=>{
    if(e.button!==0) return;
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let ghost = null;
    function move(ev){
      if(!ghost){
        if(Math.hypot(ev.clientX-startX, ev.clientY-startY) < DRAG_THRESHOLD) return;
        ghost = chip.closest('.hand-token').querySelector('.dot').cloneNode(true);
        if(all) ghost.innerHTML += `<span class="ghost-qty">${state.handTokens.get(type)||0}</span>`;
        ghost.classList.add('hand-token-ghost');
        document.body.appendChild(ghost);
      }
      ghost.style.left = (ev.clientX-14)+'px'; ghost.style.top = (ev.clientY-14)+'px';
      const vp = document.getElementById('boardViewport').getBoundingClientRect();
      const overBoard = ev.clientX>=vp.left && ev.clientX<=vp.right && ev.clientY>=vp.top && ev.clientY<=vp.bottom;
      const target = overBoard ? findTokenMergeTarget({id:null, type}, clientToWorld(ev.clientX, ev.clientY).x, clientToWorld(ev.clientX, ev.clientY).y) : null;
      if(target) showTokenMergeHighlight(target.id); else clearTokenMergeHighlight();
    }
    function up(ev){
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      clearTokenMergeHighlight();
      if(!ghost) return;
      ghost.remove();
      const vp = document.getElementById('boardViewport').getBoundingClientRect();
      if(ev.clientX<vp.left || ev.clientX>vp.right || ev.clientY<vp.top || ev.clientY>vp.bottom) return;
      playHandToken(type, ev.clientX, ev.clientY, all ? (state.handTokens.get(type)||0) : 1);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
function playHandToken(type, clientX, clientY, amount){
  const have = state.handTokens.get(type)||0;
  amount = Math.min(amount||1, have);
  if(amount<=0) return;
  state.handTokens.set(type, have-amount);
  if(have-amount<=0) state.handTokens.delete(type);
  const world = clientToWorld(clientX, clientY);
  const host = findPieceAtPoint(world.x, world.y);
  const target = findTokenMergeTarget({id:null, type}, world.x, world.y) || (host && attachedTokenOfType(host.id, type, null));
  let undoBoard;
  if(!target && host){
    const id = newTokenId();
    doAction('PLACE_TOKEN', { id, x:world.x-22, y:world.y-22, type, count:amount, attachedTo:host.id, attachedCardIndex:cardIndexAtPoint(host, world.x, world.y) });
    undoBoard = ()=> doAction('REMOVE_TOKEN', {id});
  } else if(target){
    const old = target.count;
    doAction('SET_TOKEN_COUNT', {id:target.id, count:old+amount});
    undoBoard = ()=> doAction('SET_TOKEN_COUNT', {id:target.id, count:old});
  } else {
    const {x, y} = snapPos(world.x-22, world.y-22, 44, 44);
    const snapped = applyZoneSnap(x, y, 44, 44);
    const id = newTokenId();
    doAction('PLACE_TOKEN', { id, x:snapped.x, y:snapped.y, type, count:amount, attachedTo:null });
    undoBoard = ()=> doAction('REMOVE_TOKEN', {id});
  }
  const what = amount===1 ? `a ${type} token` : `${amount} ${type} tokens`;
  renderHand();
  syncHandCount(`played ${what} from hand`);
  setUndo(()=>{
    undoBoard();
    state.handTokens.set(type, (state.handTokens.get(type)||0) + amount);
    renderHand();
    syncHandCount(`took ${what} back into hand`);
  });
}

