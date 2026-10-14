/* =========================================================================
   TOKENS — an all-purpose game room has no built-in token vocabulary: every
   token type (name + color) is created by a player and shared table-wide
   (state.tokenTypes, synced via DEFINE_TOKEN_TYPE), then available to
   everyone for the rest of the game. Standalone on the board, or attached to
   a specific piece (rendered anchored to its corner, moving with it).
   ========================================================================= */
// Where the token menu opens and where its token lands: the board spot that
// was right-clicked (see openTokenTypeMenuAt), or the middle of the board.
let tokenMenuAnchor = null, tokenPlaceAtWorld = null;
function tokenMenuAnchorEl(){
  let {x, y} = tokenMenuAnchor || {};
  if(!tokenMenuAnchor){
    const r = document.getElementById('boardViewport').getBoundingClientRect();
    x = r.left + r.width/2; y = r.top + r.height/2;
  }
  return { getBoundingClientRect: ()=>({left:x, right:x, top:y, bottom:y, width:0, height:0}) };
}
function openTokenTypeMenuAt(clientX, clientY){
  tokenMenuAnchor = {x:clientX, y:clientY};
  tokenPlaceAtWorld = clientToWorld(clientX, clientY);
  openTokenTypeMenu();
}
// ---- Token looks. A type's color lives in state.tokenTypes (as it always
// has); everything else — symbol (letter, emoji or short text), uploaded
// image, shape — lives in state.tokenTypeStyles. Every place a token is drawn
// (board, card labels, hand tray, player chips, menus) goes through
// tokenFaceMarkup so they all match.
function setTokenTypeStyle(name, src){
  const st = { symbol:(src && src.symbol)||'', image:(src && src.image)||'', shape:(src && src.shape)||'circle' };
  if(st.symbol || st.image || st.shape!=='circle') state.tokenTypeStyles.set(name, st); else state.tokenTypeStyles.delete(name);
}
function tokenFaceMarkup(type, cls, styleOverride){
  const color = state.tokenTypes.get(type) || '#546178';
  const st = styleOverride || state.tokenTypeStyles.get(type) || {};
  const bg = `background-color:${color};` + (st.image ? `background-image:url('${st.image}');` : '');
  const sym = st.image ? '' : escapeHtml(st.symbol || ((type||'?')[0]||'?').toUpperCase());
  return `<span class="${cls} tface shape-${st.shape||'circle'}" style="${bg}">${sym}</span>`;
}
function openTokenTypeMenu(){
  const menu = document.getElementById('tokenMenu');
  const types = [...state.tokenTypes.keys()];
  // Each type: click the row to place one; the pencil edits the type.
  menu.innerHTML = types.map(name=>
    `<div class="token-type-item" data-type="${escapeHtml(name)}">${tokenFaceMarkup(name,'token-dot')}${escapeHtml(name)}<span class="token-type-edit" data-edit="${escapeHtml(name)}" title="Edit this token type">✎</span></div>`
  ).join('') + `<div class="token-type-item" data-type="__new"><span class="token-dot" style="background:var(--surface-2);border:1px dashed var(--text-soft);"></span>New type…</div>`;
  menu.querySelectorAll('[data-edit]').forEach(el=>{
    el.addEventListener('click', (e)=>{ e.stopPropagation(); openTokenTypeEditor(el.dataset.edit); });
  });
  menu.querySelectorAll('[data-type]').forEach(el=>{
    el.addEventListener('click', (e)=>{
      // stopPropagation: the editor replaces this element — without it, the
      // document-level outside-click closer sees a detached target and hides the menu.
      e.stopPropagation();
      if(el.dataset.type==='__new') openTokenTypeEditor(null);
      else { placeNewToken(el.dataset.type); menu.classList.add('hidden'); }
    });
  });
  menu.classList.remove('hidden');
  positionMenuNear(menu, tokenMenuAnchorEl());
}
const TOKEN_EMOJIS = ['❤️','💀','⚔️','🛡️','⭐','🔥','💧','⚡','🌿','☠️','🪙','💰','💎','🎯','🏹','🗡️','🧪','🍀','👑','🔮','🩸','🌙','☀️','❄️','💥','🌀','👁️','🧠','🦴','🕯️','⏳','🔒','🎲','⚙️','🏰','🐉','👻','🕸️','🪨','🌊'];
// Shrinks an uploaded image to a small square (center-cropped) so it syncs to
// everyone instantly inside the token type itself.
function tokenImageFromFile(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=> reject(new Error('Could not read that file.'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=> reject(new Error('That file does not look like an image.'));
      img.onload = ()=>{
        const size = 96, c = document.createElement('canvas');
        c.width = size; c.height = size;
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, (img.naturalWidth-side)/2, (img.naturalHeight-side)/2, side, side, 0, 0, size, size);
        let url = c.toDataURL('image/png');
        if(url.length > 40000) url = c.toDataURL('image/jpeg', 0.85);
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// Create (oldName null) or edit a token type: name, color, shape, symbol
// (any letter, emoji or up to 2 characters), or an uploaded image.
// afterCreate(name), when given, replaces placing a new token (see Swap Token).
function openTokenTypeEditor(oldName, afterCreate){
  const menu = document.getElementById('tokenMenu');
  const editing = oldName!=null;
  const cur = editing ? (state.tokenTypeStyles.get(oldName) || {}) : {};
  const draft = { name: editing ? oldName : '', color: editing ? (state.tokenTypes.get(oldName)||'#546178') : '#546178',
    symbol: cur.symbol||'', image: cur.image||'', shape: cur.shape||'circle' };
  const old = { ...draft };
  menu.innerHTML = `
    <div class="tt-editor">
      <div class="tt-top"><span id="ttPreviewHost"></span><input type="text" id="ttName" placeholder="Name, e.g. Poison" value="${escapeHtml(draft.name)}"></div>
      <div class="popover-row"><label>Color</label><input type="color" id="ttColor" value="${draft.color}"></div>
      <div class="popover-row"><label>Shape</label><div class="tt-choices" id="ttShapes">
        ${['circle','square','hex'].map(sh=>`<div class="tt-choice" data-shape="${sh}" title="${sh}"><span class="tface shape-${sh}"></span></div>`).join('')}</div></div>
      <div class="popover-row"><label>Symbol</label><input type="text" id="ttSymbol" maxlength="4" placeholder="First letter" value="${escapeHtml(draft.symbol)}" style="width:90px;"></div>
      <div class="tt-emojis">${TOKEN_EMOJIS.map(e=>`<span class="tt-emoji" data-emoji="${e}">${e}</span>`).join('')}</div>
      <div class="popover-row"><label>Image</label><div style="display:flex;gap:4px;">
        <div class="btn btn-sm" id="ttUpload">Upload…</div><div class="btn btn-sm" id="ttClearImage">Remove</div></div></div>
      <input type="file" id="ttFile" accept="image/*" style="display:none;">
      <div class="tt-error" id="ttError"></div>
      <div class="popover-actions"><div class="btn btn-accent btn-sm" id="ttSave" style="flex:1;justify-content:center;">${editing ? 'Save' : afterCreate ? 'Create &amp; Swap' : 'Create &amp; Place'}</div></div>
    </div>`;
  const $ = id=> document.getElementById(id);
  function refresh(){
    $('ttPreviewHost').innerHTML = tokenFaceMarkup(draft.name||'?', 'tt-preview', {symbol:draft.symbol, image:draft.image, shape:draft.shape})
      .replace(/background-color:[^;]*;/, `background-color:${draft.color};`);
    menu.querySelectorAll('.tt-choice').forEach(el=> el.classList.toggle('on', el.dataset.shape===draft.shape));
    menu.querySelectorAll('.tt-choice .tface').forEach(el=> el.style.backgroundColor = draft.color);
    $('ttClearImage').style.display = draft.image ? '' : 'none';
  }
  // Keeps a symbol to at most 2 characters as people see them (an emoji is one).
  const clip = t=>{ try{ return [...new Intl.Segmenter().segment(t)].slice(0,2).map(x=>x.segment).join(''); }catch(e){ return [...t].slice(0,2).join(''); } };
  $('ttName').addEventListener('input', e=>{ draft.name = e.target.value.trim(); refresh(); });
  $('ttColor').addEventListener('input', e=>{ draft.color = e.target.value; refresh(); });
  $('ttSymbol').addEventListener('input', e=>{ draft.symbol = clip(e.target.value.trim()); refresh(); });
  menu.querySelectorAll('.tt-choice').forEach(el=> el.addEventListener('click', (e)=>{ e.stopPropagation(); draft.shape = el.dataset.shape; refresh(); }));
  menu.querySelectorAll('.tt-emoji').forEach(el=> el.addEventListener('click', (e)=>{ e.stopPropagation(); draft.symbol = el.dataset.emoji; draft.image = ''; $('ttSymbol').value = draft.symbol; refresh(); }));
  $('ttUpload').addEventListener('click', (e)=>{ e.stopPropagation(); $('ttFile').click(); });
  $('ttFile').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    try{ draft.image = await tokenImageFromFile(file); $('ttError').textContent = ''; }
    catch(err){ $('ttError').textContent = err.message; }
    refresh();
  });
  $('ttClearImage').addEventListener('click', (e)=>{ e.stopPropagation(); draft.image = ''; refresh(); });
  $('ttSave').addEventListener('click', (e)=>{
    e.stopPropagation();
    if(!draft.name){ $('ttError').textContent = 'Give it a name.'; return; }
    if(draft.name!==oldName && state.tokenTypes.has(draft.name)){ $('ttError').textContent = 'There is already a token type with that name.'; return; }
    const look = {color:draft.color, symbol:draft.symbol, image:draft.image, shape:draft.shape};
    if(editing){
      doAction('EDIT_TOKEN_TYPE', {oldName, name:draft.name, ...look});
      setUndo(()=> doAction('EDIT_TOKEN_TYPE', {oldName:draft.name, name:old.name, color:old.color, symbol:old.symbol, image:old.image, shape:old.shape}));
    } else {
      doAction('DEFINE_TOKEN_TYPE', {name:draft.name, ...look});
      if(afterCreate) afterCreate(draft.name); else placeNewToken(draft.name);
    }
    menu.classList.add('hidden');
  });
  $('ttName').addEventListener('keydown', e=>{ if(e.key==='Enter') $('ttSave').click(); });
  refresh();
  positionMenuNear(menu, tokenMenuAnchorEl());
  if(!editing) $('ttName').focus();
}
document.addEventListener('click', (e)=>{ if(!e.target.closest('#tokenMenu')) document.getElementById('tokenMenu').classList.add('hidden'); });

function placeNewToken(type){
  const vp = document.getElementById('boardViewport');
  const worldX = tokenPlaceAtWorld ? tokenPlaceAtWorld.x - 22 : (vp.clientWidth/2 - state.view.x)/state.view.scale - 22;
  const worldY = tokenPlaceAtWorld ? tokenPlaceAtWorld.y - 22 : (vp.clientHeight/2 - state.view.y)/state.view.scale - 22;
  const id = newTokenId();
  doAction('PLACE_TOKEN', { id, x:worldX, y:worldY, type, count:1, attachedTo:null });
  setUndo(()=> doAction('REMOVE_TOKEN', {id}));
}
// Where a token actually renders: its own x/y, unless it's attached to a
// piece, in which case it rides the host's top-right corner instead. Shared
// by rendering, live drag math, and merge-target hit-testing so all three
// agree on exactly where a token is.
function tokenRenderPos(t){
  if(t.attachedTo){
    const pos = attachedTokenPos(t);
    if(pos) return pos;
  }
  return {x:t.x, y:t.y};
}
// A token stack's own on-board size — attached tokens render smaller (riding
// a piece's corner) than freestanding ones. Shared by rendering, splay-extent
// math, and drop-point math so they all agree.
function tokenSize(t){ return t.attachedTo ? 28 : 44; }
function renderTokens(){
  const world = document.getElementById('boardWorld');
  state.tokens.forEach(t=>{
    if(t.attachedTo && state.pieces.has(t.attachedTo)) return; // shown as a chip in its card's label instead (attachedTokenChipsHtml)
    if(!onCurrentTab(t)) return; // another tab's token
    const el = document.createElement('div');
    el.dataset.id = t.id;
    const pos = tokenRenderPos(t);
    const size = tokenSize(t);

    el.style.left = pos.x+'px'; el.style.top = pos.y+'px';
    el.className = 'token' + (t.attachedTo?' attached':'') + (state.selectedTokenIds.has(t.id)?' selected':'');

    // The type letter always stays put — the quantity shows as its own small
    // bubble in the top-right corner instead, rather than replacing the
    // letter (a token has no label text to fold a count into). The bubble
    // shows whenever the count ISN'T exactly 1 — a token can now sit at zero
    // or go negative (see SET_TOKEN_COUNT), so "count!==1" (not "count>1") is
    // what actually means "this needs its number called out."
    el.innerHTML = tokenFaceMarkup(t.type, 'token-face') +
      (t.count!==1 ? `<div class="token-count">${t.count}</div>` : '') +
      (t.count<=0 ? `<div class="token-remove" title="Remove this empty stack">✕</div>` : '');
    // A stack at zero or below gets a small ✕ (shown on hover, touching the
    // token's bottom edge) that removes the whole stack — undoable.
    const removeEl = el.querySelector('.token-remove');
    if(removeEl){
      ['mousedown','pointerdown','mouseup','dblclick','contextmenu'].forEach(ev=> removeEl.addEventListener(ev, (e)=> e.stopPropagation()));
      removeEl.addEventListener('click', (e)=>{
        e.stopPropagation(); e.preventDefault();
        const clone = JSON.parse(JSON.stringify(t));
        if(hoveredTokenId===t.id){ hoveredTokenId = null; hideHotkeyHint(); endTokenHotkeyRun(); }
        doAction('REMOVE_TOKEN', {id:t.id});
        setUndo(()=> doAction('PLACE_TOKEN', clone));
      });
    }
    // Exactly 1 just moves as a whole (Seth: "it is not a stack to be
    // peeled"); anything else — 2+, or zero/negative — drags via the peel
    // interaction instead (peelTokenToBoard itself decides what a "peel"
    // means for a non-positive stack: see its own comment).
    if(t.count!==1) wireTokenPeelInteraction(el, t);
    else wireTokenDrag(el, t);
    el.title = `${t.type} (${t.count})`;
    // W/↑ and S/↓ adjust whichever token is under the cursor (see the
    // keydown listener after renderTokens).
    el.addEventListener('mouseenter', ()=>{ hoveredTokenId = t.id; showTokenHotkeyHint(el); });
    el.addEventListener('mouseleave', ()=>{ if(hoveredTokenId===t.id){ hoveredTokenId = null; hideHotkeyHint(); endTokenHotkeyRun(); } });
    world.appendChild(el);
    if(hoveredTokenId===t.id) showTokenHotkeyHint(el); // re-anchor after a rebuild, e.g. the count just changed
    // Whichever branch rendered it, the quantity bubble (when present) is
    // ALWAYS also a whole-stack move handle — mirrors a card pile's label
    // handle, since a token has no label of its own to serve that role.
    const countEl = el.querySelector('.token-count');
    if(countEl) wireTokenGroupHandleDrag(countEl, t);
  });
}
let hoveredTokenId = null;
function showTokenHotkeyHint(el){
  if(!hoverRemindersOn) return;
  if(pointerDragging) return; // no reminders while moving things (see pointerDragging)
  const hint = document.getElementById('hotkeyHint');
  hint.innerHTML = tokenKeyboardHintHtml();
  hint.classList.remove('hidden');
  // Keep clear of the quantity bubble (and the remove button): they hang off
  // the token's own box, so measuring just the token put the reminder on them.
  const tr = el.getBoundingClientRect(), h = hint.getBoundingClientRect();
  let r = {left:tr.left, top:tr.top, right:tr.right, bottom:tr.bottom};
  el.querySelectorAll('.token-count, .token-remove').forEach(x=>{
    const xr = x.getBoundingClientRect();
    if(!xr.width && !xr.height) return;
    r = {left:Math.min(r.left, xr.left), top:Math.min(r.top, xr.top), right:Math.max(r.right, xr.right), bottom:Math.max(r.bottom, xr.bottom)};
  });
  const gap = 12;
  let top = r.top - h.height - gap;
  if(top < 4) top = r.bottom + gap;
  hint.style.left = Math.max(4, Math.min((r.left + r.right)/2 - h.width/2, window.innerWidth - h.width - 4))+'px';
  hint.style.top = top+'px';
}
document.addEventListener('keydown', (e)=>{
  if(!hoveredTokenId || e.ctrlKey || e.metaKey || e.altKey) return;
  if(isTextEntryFocused()) return;
  if(!state.tokens.has(hoveredTokenId)){ hoveredTokenId = null; return; }
  // A number key sets the stack to that value; typing a second digit soon
  // after the first makes it two digits (1 then 2 = 12).
  if(/^[0-9]$/.test(e.key)){
    e.preventDefault();
    const now = Date.now();
    tokenDigitBuf = (tokenDigitId===hoveredTokenId && now - tokenDigitAt < 900 && tokenDigitBuf.length<3) ? tokenDigitBuf + e.key : e.key;
    tokenDigitId = hoveredTokenId; tokenDigitAt = now;
    hotkeySetToken(hoveredTokenId, Number(tokenDigitBuf));
    return;
  }
  const k = e.key.toLowerCase();
  const delta = k==='w' ? 1 : k==='s' ? -1 : 0;
  if(!delta) return;
  e.preventDefault();
  hotkeyAdjustToken(hoveredTokenId, delta);
});
let tokenDigitBuf = '', tokenDigitId = null, tokenDigitAt = 0;
// Hotkey changes sync live but quietly (no chat line per press); when the
// cursor leaves the token, one summary goes to the table — "changed Damage
// from 5 to 8" — and one Undo reverts the whole run.
let tokenHotkeyRun = null; // {id, type, startCount}
function hotkeyAdjustToken(id, delta){
  const t = state.tokens.get(id); if(!t) return;
  hotkeySetToken(id, t.count+delta);
}
function hotkeySetToken(id, count){
  const t = state.tokens.get(id); if(!t || t.count===count) return;
  if(!tokenHotkeyRun || tokenHotkeyRun.id!==id){ endTokenHotkeyRun(); tokenHotkeyRun = {id, type:t.type, startCount:t.count}; }
  const payload = {id, count, quiet:true};
  applyRoomEvent('SET_TOKEN_COUNT', payload);
  postRoomEvent('SET_TOKEN_COUNT', payload);
}
// Backstop for hover tracking: a count change rebuilds the token's element, and
// a removed element never fires mouseleave — so also end the hover (and send
// the summary) the moment the cursor is over anything that isn't this token.
window.addEventListener('mousemove', (e)=>{
  if(!hoveredTokenId) return;
  const tEl = e.target && e.target.closest && e.target.closest('.token, .label-token');
  if(tEl && tEl.dataset.id===hoveredTokenId) return;
  hoveredTokenId = null; hideHotkeyHint(); endTokenHotkeyRun();
});
function endTokenHotkeyRun(){
  const run = tokenHotkeyRun; tokenHotkeyRun = null;
  if(!run) return;
  const t = state.tokens.get(run.id);
  if(!t || t.count===run.startCount) return;
  doNote(`changed ${run.type} from ${run.startCount} to ${t.count}`);
  setUndo(()=> doAction('SET_TOKEN_COUNT', {id:run.id, count:run.startCount}));
}
// Drop-target detection for combining two token stacks of the SAME type into
// one (adds their counts) — the token equivalent of findOverlapTarget for
// cards. Different-typed tokens never combine (a count is only meaningful
// within one type), so those just land as their own separate token as before.
function findTokenMergeTarget(draggedToken, worldX, worldY){
  for(const t of state.tokens.values()){
    if(t.id===draggedToken.id || t.type!==draggedToken.type) continue;
    if(t.attachedTo || !onCurrentTab(t)) continue; // tokens on a card live in its label — dropping onto the card joins them (see landTokenAt)
    const pos = tokenRenderPos(t);
    const size = tokenSize(t);
    if(worldX>=pos.x && worldX<=pos.x+size && worldY>=pos.y && worldY<=pos.y+size) return t;
  }
  return null;
}
function mergeTokenOntoTarget(sourceId, targetId){
  const source = state.tokens.get(sourceId), target = state.tokens.get(targetId);
  if(!source || !target) return;
  const oldTargetCount = target.count;
  const oldSource = { id:source.id, x:source.x, y:source.y, type:source.type, count:source.count, attachedTo:source.attachedTo };
  doAction('SET_TOKEN_COUNT', {id:targetId, count: target.count + source.count});
  doAction('REMOVE_TOKEN', {id:sourceId});
  setUndo(()=>{
    doAction('PLACE_TOKEN', oldSource);
    doAction('SET_TOKEN_COUNT', {id:targetId, count: oldTargetCount});
  });
}
// Live "you're about to combine these" feedback while dragging one token
// stack over another same-type one — mirrors showMergeHighlight/
// clearMergeHighlight for cards: a green outline plus the target's quantity
// bubble (creating a blank one if it doesn't have one yet, i.e. it's
// currently a lone token) flips to a green "+".
let tokenMergeHighlightId = null;
function showTokenMergeHighlight(tokenId){
  if(tokenMergeHighlightId === tokenId) return;
  clearTokenMergeHighlight();
  const el = document.querySelector(`.token[data-id="${tokenId}"]`);
  if(!el) return;
  el.classList.add('merge-target');
  let countEl = el.querySelector('.token-count');
  if(countEl){
    countEl.dataset.origCount = countEl.textContent;
    countEl.textContent = '+';
  } else {
    countEl = document.createElement('div');
    countEl.className = 'token-count merge-temp';
    countEl.textContent = '+';
    el.appendChild(countEl);
  }
  tokenMergeHighlightId = tokenId;
}
function clearTokenMergeHighlight(){
  if(!tokenMergeHighlightId) return;
  const el = document.querySelector(`.token[data-id="${tokenMergeHighlightId}"]`);
  if(el){
    el.classList.remove('merge-target');
    const tempBadge = el.querySelector('.token-count.merge-temp');
    if(tempBadge){ tempBadge.remove(); }
    else {
      const countEl = el.querySelector('.token-count');
      if(countEl && countEl.dataset.origCount!==undefined){
        countEl.textContent = countEl.dataset.origCount;
        delete countEl.dataset.origCount;
      }
    }
  }
  tokenMergeHighlightId = null;
}
// Shared landing logic for a whole-token move (used by both a plain drag on a
// lone token, and a drag from the "move whole stack" quantity-bubble handle
// on a multi-token stack) — snap, merge-check, attach-check, and undo, all in
// one place. Mirrors finishWholeMove for pieces.
function finishWholeTokenMove(t, dx, dy){
  const start = tokenRenderPos(t);
  const d = screenDeltaToWorldDelta(dx, dy);
  landTokenAt(t, start.x+d.x, start.y+d.y);
}
// Tokens attached to a card or stack are shown as chips in its label rather
// than on the card itself. Each chip is a full token: hover for W/S/scroll,
// right-click for its menu, drag it off to move/detach it (or into your hand).
function attachedTokenChipsHtml(p){
  const mine = [...state.tokens.values()].filter(t=> t.attachedTo===p.id).sort((a,b)=> a.type.localeCompare(b.type));
  return mine.map(t=> `<span class="label-token" data-id="${t.id}" title="${escapeHtml(t.type)} ×${t.count}">${tokenFaceMarkup(t.type,'lt-face')}${t.count!==1 ? `<b>${t.count}</b>` : ''}</span>`).join('');
}
function wireLabelTokenChip(chip, t){
  chip.addEventListener('mouseenter', ()=>{ hoveredTokenId = t.id; showTokenHotkeyHint(chip); });
  chip.addEventListener('mouseleave', ()=>{ if(hoveredTokenId===t.id){ hoveredTokenId = null; hideHotkeyHint(); endTokenHotkeyRun(); } });
  let ghost = null;
  wirePressDragClick(chip, {
    onDown: ()=>{},
    onMove: (dx, dy, ev)=>{
      if(!ghost){
        ghost = chip.querySelector('.lt-face').cloneNode(true);
        ghost.classList.add('hand-token-ghost', 'lt-ghost');
        document.body.appendChild(ghost);
      }
      ghost.style.left = (ev.clientX-14)+'px'; ghost.style.top = (ev.clientY-14)+'px';
      const w = clientToWorld(ev.clientX, ev.clientY);
      const mt = findTokenMergeTarget(t, w.x, w.y);
      if(mt) showTokenMergeHighlight(mt.id); else clearTokenMergeHighlight();
      tokenHandHover(ev);
    },
    onContext: (e)=> openTokenRadialMenu(t.id, e.clientX, e.clientY),
    onDrop: (dx, dy, ev)=>{
      if(ghost){ ghost.remove(); ghost = null; }
      clearTokenMergeHighlight(); clearTokenHandHover();
      if(isOverHandPanel(ev.clientX, ev.clientY) && t.count>0){ sendTokenToHand(t.id, t.count); return; }
      const toTab = tabAtPoint(ev.clientX, ev.clientY);
      if(toTab){ moveObjectsToTab([{kind:'token', id:t.id}], toTab); renderBoard(); return; }
      const w = clientToWorld(ev.clientX, ev.clientY);
      landTokenAt(t, w.x-22, w.y-22);
    },
  });
}
// Where the tokens already sitting on a card (as label chips) of this type are, if any.
function attachedTokenOfType(pieceId, type, exceptId){
  for(const t of state.tokens.values()) if(t.attachedTo===pieceId && t.type===type && t.id!==exceptId) return t;
  return null;
}
// Lands a whole token stack with its top-left at (x, y) in board space:
// joins a same-type stack it's dropped on; dropped on a card, attaches there
// (joining that card's same-type token if it has one); otherwise just moves.
function landTokenAt(t, x, y){
  const oldX = t.x, oldY = t.y, oldAttached = t.attachedTo, oldCardIndex = t.attachedCardIndex;
  let {x:newX, y:newY} = snapPos(x, y, 44, 44);
  const hostForJoin = findPieceAtPoint(newX+22, newY+22);
  const joinTarget = hostForJoin && attachedTokenOfType(hostForJoin.id, t.type, t.id);
  if(joinTarget && joinTarget.attachedTo!==t.attachedTo){ mergeTokenOntoTarget(t.id, joinTarget.id); return; }
  const mergeTarget = findTokenMergeTarget(t, newX+22, newY+22); // 22 = half the token's own size, so we test its CENTER
  if(mergeTarget){
    mergeTokenOntoTarget(t.id, mergeTarget.id); // re-renders the board itself, sets its own undo
    return;
  }
  const hostPiece = findPieceAtPoint(newX+22, newY+22);
  if(!hostPiece) ({x:newX, y:newY} = applyZoneSnap(newX, newY, 44, 44)); // attaching to a piece takes priority over zone snap
  // Which specific card (of a card pile) the drop point landed on — the
  // token attaches to THAT card, not the pile as a whole (see
  // attachedTokenPos/cardIndexAtPoint). Tested at the same drop-center point
  // used to find hostPiece itself, so "which piece" and "which card of it"
  // always agree.
  const cardIndex = hostPiece ? cardIndexAtPoint(hostPiece, newX+22, newY+22) : null;
  doAction('MOVE_TOKEN', {id:t.id, x:newX, y:newY, attachedTo:hostPiece?hostPiece.id:null, attachedCardIndex:cardIndex});
  setUndo(()=> doAction('MOVE_TOKEN', {id:t.id, x:oldX, y:oldY, attachedTo:oldAttached, attachedCardIndex:oldCardIndex}));
}
// Same click-opens-menu / drag-moves model as pieces (see wirePressDragClick):
// a plain click opens the token's radial menu — +1 lives there now rather
// than being the default click action, since a click is also how you get to
// Remove/Detach and it should behave the same way everywhere on the board.
// Used for a LONE token (count===1) — nothing to peel, so a plain drag just
// moves it as a whole, same as wireWholeInteraction for a single-card piece.
function wireTokenDrag(el, t){
  let ghost=null;
  wirePressDragClick(el, {
    onDown: (e)=>{ if(handleTokenSelectionOnDown(t, e)) return false; },
    onMove: (dx, dy, ev)=>{
      const start = tokenRenderPos(t);
      const d = screenDeltaToWorldDelta(dx, dy);
      const nx = start.x+d.x, ny = start.y+d.y;
      const liveEl = el.isConnected ? el : document.querySelector(`.token[data-id="${t.id}"]`); // see driveWholePieceDrag on re-renders mid-drag
      if(liveEl){ liveEl.style.left = nx+'px'; liveEl.style.top = ny+'px'; }
      if(!ghost || !ghost.isConnected) ghost = createDragGhost(); // renderBoard (a flip/rotate, or anyone else's action) wipes it mid-drag
      updateDragGhost(ghost, nx, ny, 44, 44);
      const mergeTarget = findTokenMergeTarget(t, nx+22, ny+22);
      if(mergeTarget) showTokenMergeHighlight(mergeTarget.id); else clearTokenMergeHighlight();
      tokenHandHover(ev);
    },
    onContext: (e)=> openTokenRadialMenu(t.id, e.clientX, e.clientY),
    onDrop: (dx, dy, ev)=>{
      removeDragGhost(ghost); ghost=null;
      clearTokenMergeHighlight(); clearTokenHandHover();
      if(isOverHandPanel(ev.clientX, ev.clientY) && t.count>0){ sendTokenToHand(t.id, t.count); return; }
      const toTab = tabAtPoint(ev.clientX, ev.clientY);
      if(toTab){ moveObjectsToTab([{kind:'token', id:t.id}], toTab); renderBoard(); return; }
      finishWholeTokenMove(t, dx, dy);
    },
  });
}
// The stack's quantity bubble, doubling as its "move whole stack" handle —
// always a whole-token move (never a peel), present whenever count>1
// regardless of splay state. Mirrors wireGroupHandleDrag for card piles.
function wireTokenGroupHandleDrag(handleEl, t){
  let startPos, ghost=null;
  wirePressDragClick(handleEl, {
    onDown: (e)=>{ if(handleTokenSelectionOnDown(t, e)) return false; startPos = tokenRenderPos(t); },
    onMove: (dx, dy, ev)=>{
      const d = screenDeltaToWorldDelta(dx, dy);
      const nx = startPos.x+d.x, ny = startPos.y+d.y;
      const tokenEl = handleEl.isConnected ? handleEl.closest('.token') : document.querySelector(`.token[data-id="${t.id}"]`);
      if(tokenEl){ tokenEl.style.left = nx+'px'; tokenEl.style.top = ny+'px'; }
      if(!ghost || !ghost.isConnected) ghost = createDragGhost(); // renderBoard (a flip/rotate, or anyone else's action) wipes it mid-drag
      const size = tokenSize(t);
      updateDragGhost(ghost, nx, ny, size, size);
      const mergeTarget = findTokenMergeTarget(t, nx+22, ny+22);
      if(mergeTarget) showTokenMergeHighlight(mergeTarget.id); else clearTokenMergeHighlight();
      tokenHandHover(ev);
    },
    onDrop: (dx, dy, ev)=>{
      removeDragGhost(ghost); ghost=null;
      clearTokenMergeHighlight(); clearTokenHandHover();
      if(isOverHandPanel(ev.clientX, ev.clientY) && t.count>0){ sendTokenToHand(t.id, t.count); return; } // the whole stack goes in
      const toTab = tabAtPoint(ev.clientX, ev.clientY);
      if(toTab){ moveObjectsToTab([{kind:'token', id:t.id}], toTab); renderBoard(); return; }
      finishWholeTokenMove(t, dx, dy);
    },
  });
}
// Click+drag on ONE specific visible face of a multi-token stack (splayed or
// not) — a plain click still opens the stack's radial menu, but a drag peels
// exactly one token off into its own new lone token, following the cursor
// with a ghost preview and landing at the drop point. Mirrors
// wirePeelInteraction for card piles.
function wireTokenPeelInteraction(faceEl, t){
  let ghost=null;
  wirePressDragClick(faceEl, {
    onDown: (e)=>{ if(handleTokenSelectionOnDown(t, e)) return false; },
    onMove: (dx, dy, ev)=>{
      if(!ghost || !ghost.isConnected) ghost = createDragGhost(); // renderBoard (a flip/rotate, or anyone else's action) wipes it mid-drag
      const world = clientToWorld(ev.clientX, ev.clientY);
      const size = tokenSize(t);
      updateDragGhost(ghost, world.x-size/2, world.y-size/2, size, size);
      // Hovering another stack of the same type: preview adding the peeled
      // token to it (same green "+" as a whole-stack merge).
      const target = peelTokenTarget(t, world);
      if(target) showTokenMergeHighlight(target.id); else clearTokenMergeHighlight();
      tokenHandHover(ev);
    },
    onContext: (e)=> openTokenRadialMenu(t.id, e.clientX, e.clientY),
    onDrop: (dx, dy, ev)=>{
      removeDragGhost(ghost); ghost=null;
      clearTokenMergeHighlight(); clearTokenHandHover();
      if(isOverHandPanel(ev.clientX, ev.clientY) && t.count!==1){ sendTokenToHand(t.id, 1); return; } // peeling puts just one in
      const toTab = tabAtPoint(ev.clientX, ev.clientY);
      if(toTab && t.count!==1){
        // One token peeled off onto another tab: it appears there beside where this stack is.
        const old = t.count, nid = newTokenId();
        doAction('SET_TOKEN_COUNT', {id:t.id, count:old-1});
        doAction('PLACE_TOKEN', {id:nid, x:t.x+50, y:t.y, type:t.type, count:1, attachedTo:null, tab:toTab});
        setUndo(()=>{ doAction('REMOVE_TOKEN', {id:nid}); doAction('SET_TOKEN_COUNT', {id:t.id, count:old}); });
        toast(`Moved to "${tabName(toTab)}"`);
        return;
      }
      const target = peelTokenTarget(t, clientToWorld(ev.clientX, ev.clientY));
      if(target) peelTokenOntoStack(t.id, target.id);
      else peelTokenToBoard(t.id, ev.clientX, ev.clientY);
    },
  });
}
// Pulls exactly one token off a stack and drops it as its own new lone token
// at the given screen point, decrementing the stack's count by one. Mirrors
// placePeeledCardToBoard for card piles. A stack at zero or below (a counter
// that's been drawn down — see SET_TOKEN_COUNT) peels the same way: it counts
// one further down, and you still come away holding one token (Seth).
function peelTokenToBoard(tokenId, clientX, clientY){
  const t = state.tokens.get(tokenId); if(!t || t.count===1) return; // exactly 1 is wireTokenDrag's job, not peeling
  const oldCount = t.count;
  const world = clientToWorld(clientX, clientY);
  // Dropped on a card: the peeled token goes onto that card (joining its same-type token, if any).
  const host = findPieceAtPoint(world.x, world.y);
  if(host){
    const join = attachedTokenOfType(host.id, t.type, t.id);
    doAction('SET_TOKEN_COUNT', {id:tokenId, count: oldCount-1});
    if(join){
      const jOld = join.count;
      doAction('SET_TOKEN_COUNT', {id:join.id, count:jOld+1});
      setUndo(()=>{ doAction('SET_TOKEN_COUNT', {id:join.id, count:jOld}); doAction('SET_TOKEN_COUNT', {id:tokenId, count:oldCount}); });
    } else {
      const nid = newTokenId();
      doAction('PLACE_TOKEN', { id:nid, x:world.x-22, y:world.y-22, type:t.type, count:1, attachedTo:host.id, attachedCardIndex:cardIndexAtPoint(host, world.x, world.y) });
      setUndo(()=>{ doAction('REMOVE_TOKEN', {id:nid}); doAction('SET_TOKEN_COUNT', {id:tokenId, count:oldCount}); });
    }
    return;
  }
  let {x:dropX, y:dropY} = snapPos(world.x - 22, world.y - 22, 44, 44);
  ({x:dropX, y:dropY} = applyZoneSnap(dropX, dropY, 44, 44));
  doAction('SET_TOKEN_COUNT', {id:tokenId, count: oldCount-1});
  const newId = newTokenId();
  doAction('PLACE_TOKEN', { id:newId, x:dropX, y:dropY, type:t.type, count:1, attachedTo:null });
  setUndo(()=>{
    doAction('REMOVE_TOKEN', {id:newId});
    doAction('SET_TOKEN_COUNT', {id:tokenId, count:oldCount});
  });
}
// The same-type stack a peeled token would join if dropped at `world` (any
// count but exactly 1, which moves as a whole instead).
function peelTokenTarget(t, world){
  const live = state.tokens.get(t.id);
  if(!live || live.count===1) return null;
  return findTokenMergeTarget(live, world.x, world.y);
}
// Moves exactly one token from one stack onto another of the same type.
function peelTokenOntoStack(sourceId, targetId){
  const source = state.tokens.get(sourceId), target = state.tokens.get(targetId);
  if(!source || !target || source.count===1) return;
  const oldSource = source.count, oldTarget = target.count;
  doAction('SET_TOKEN_COUNT', {id:sourceId, count:oldSource-1});
  doAction('SET_TOKEN_COUNT', {id:targetId, count:oldTarget+1});
  setUndo(()=>{
    doAction('SET_TOKEN_COUNT', {id:sourceId, count:oldSource});
    doAction('SET_TOKEN_COUNT', {id:targetId, count:oldTarget});
  });
}
function findPieceAtPoint(worldX, worldY){
  for(const p of state.pieces.values()){
    if(!onCurrentTab(p)) continue;
    const b = pieceVisualBounds(p);
    if(worldX>=b.x && worldX<=b.x+b.w && worldY>=b.y && worldY<=b.y+b.h) return p;
  }
  return null;
}
// Adjusts a token's count by any signed amount (the radial menu's +1 and -1 items — see openTokenRadialMenu — all funnel through
// this one function). No floor at zero: a token can sit at zero or go
// negative now (a life/damage counter, not just a stack of physical chips —
// see SET_TOKEN_COUNT's own comment).
function incrementToken(tokenId, delta){
  const t = state.tokens.get(tokenId); if(!t) return;
  const oldCount = t.count;
  doAction('SET_TOKEN_COUNT', {id:tokenId, count:oldCount+delta});
  setUndo(()=> doAction('SET_TOKEN_COUNT', {id:tokenId, count:oldCount}));
}
// Positive increments fan across the TOP half of the ring, negative ones
// across the BOTTOM half, with Remove All (and Detach, when relevant) pinned
// to the left/right "equator" points between the two arcs — see
// openRadialMenu's `angle` override, added specifically for this. Radians,
// same 12-o'clock-is-zero/clockwise convention as openRadialMenu's default:
// angle 0 is 3 o'clock, -π/2 is 12 o'clock, π/2 is 6 o'clock, π is 9 o'clock.
// Both arcs are ordered smallest-to-largest magnitude going left-to-right, so
// a given magnitude's + and - items line up in the same vertical column
// (+1 upper-left / -1 lower-left, ... +10 upper-right / -10 lower-right).
const TOKEN_INCREMENTS = [1];
function tokenRadialAngle(half, indexFromLeft){ // half: 'top' or 'bottom'; indexFromLeft: 0..TOKEN_INCREMENTS.length-1
  const n = TOKEN_INCREMENTS.length;
  if(n===1) return half==='top' ? -Math.PI/2 : Math.PI/2; // a lone +1/-1 sits straight up/down
  const span = Math.PI * (n-1)/(n+3); // leaves room at each end for the items pinned on the 0/π equator (Remove All, Set Value, Detach)
  const start = half==='top' ? (-Math.PI + (Math.PI-span)/2) : ((Math.PI-span)/2);
  return start + indexFromLeft*(span/(n-1));
}
function openTokenRadialMenu(tokenId, clientX, clientY){
  let closed = false; // Set Value swaps the ring for its own little input (see openRadialMenu, which redraws after every action)
  openRadialMenu(()=>{
    if(closed) return null;
    const t = state.tokens.get(tokenId); if(!t) return null;
    const clone = JSON.parse(JSON.stringify(t)); // PLACE_TOKEN overwrites regardless of whether it currently exists, so one clone covers both "decrement" and "fully removed" undo cases
    const items = [
      ...TOKEN_INCREMENTS.map((n,i)=>({icon:'+'+n, label:'+'+n, angle:tokenRadialAngle('top',i), action:()=>incrementToken(tokenId, n)})),
      ...TOKEN_INCREMENTS.map((n,i)=>({icon:'−'+n, label:'-'+n, angle:tokenRadialAngle('bottom',i), action:()=>incrementToken(tokenId, -n)})),
      {icon:'✕', label:'Remove All', angle:0, action:()=>{ doAction('REMOVE_TOKEN', {id:tokenId}); setUndo(()=> doAction('PLACE_TOKEN', clone)); }},
      {icon:'#', label:'Set Value', angle: t.attachedTo ? Math.PI-0.45 : Math.PI, action:()=>{ closed = true; openTokenValuePopover(tokenId, clientX, clientY); }},
      // Either side of Remove All: change this token TYPE's look (every token
      // of the type changes with it), or turn this token into another type.
      {icon:'✎', label:'Edit Token', angle:-0.45, action:()=>{ closed = true; tokenMenuAnchor = {x:clientX, y:clientY}; tokenPlaceAtWorld = null; openTokenTypeEditor(t.type); }},
      {icon:'⇄', label:'Swap Token', angle:0.45, action:()=>{ closed = true; openTokenSwapMenu(tokenId, clientX, clientY); }},
    ];
    if(t.attachedTo) items.push({icon:'⤢', label:'Detach', angle:Math.PI+0.45, action:()=>{ doAction('MOVE_TOKEN', {id:tokenId, x:t.x, y:t.y, attachedTo:null}); setUndo(()=> doAction('PLACE_TOKEN', clone)); }});
    return items;
  }, clientX, clientY);
}
// "Swap Token": turns this token into another type (or a brand-new one),
// keeping its count and where it is. A token riding a card that already has
// the new type on it merges into that one instead.
function openTokenSwapMenu(tokenId, clientX, clientY){
  const t = state.tokens.get(tokenId); if(!t) return;
  showTokenSwapMenu(t.type, clientX, clientY, name=> swapTokenType(tokenId, name));
}
// The "swap for…" list itself — every other type plus New type… — calling
// onPick(newType). Shared by board tokens and hand tokens.
function showTokenSwapMenu(currentType, clientX, clientY, onPick){
  const menu = document.getElementById('tokenMenu');
  const others = [...state.tokenTypes.keys()].filter(n=> n!==currentType);
  menu.innerHTML = `<div class="token-swap-title">Swap ${tokenFaceMarkup(currentType,'token-dot')} ${escapeHtml(currentType)} for…</div>` +
    others.map(name=> `<div class="token-type-item" data-swap="${escapeHtml(name)}">${tokenFaceMarkup(name,'token-dot')}${escapeHtml(name)}</div>`).join('') +
    `<div class="token-type-item" data-swap="__new"><span class="token-dot" style="background:var(--surface-2);border:1px dashed var(--text-soft);"></span>New type…</div>`;
  tokenMenuAnchor = {x:clientX, y:clientY}; tokenPlaceAtWorld = null;
  menu.querySelectorAll('[data-swap]').forEach(el=> el.addEventListener('click', (e)=>{
    e.stopPropagation(); // the editor replaces this element (see openTokenTypeMenu)
    if(el.dataset.swap==='__new') openTokenTypeEditor(null, onPick);
    else { onPick(el.dataset.swap); menu.classList.add('hidden'); }
  }));
  menu.classList.remove('hidden');
  positionMenuNear(menu, tokenMenuAnchorEl());
}
function swapTokenType(tokenId, newType){
  const t = state.tokens.get(tokenId); if(!t || t.type===newType) return;
  const clone = JSON.parse(JSON.stringify(t));
  const join = t.attachedTo ? attachedTokenOfType(t.attachedTo, newType, t.id) : null;
  if(join){
    const jOld = join.count;
    doAction('SET_TOKEN_COUNT', {id:join.id, count:jOld + t.count});
    doAction('REMOVE_TOKEN', {id:tokenId});
    setUndo(()=>{ doAction('SET_TOKEN_COUNT', {id:join.id, count:jOld}); doAction('PLACE_TOKEN', clone); });
  } else {
    doAction('PLACE_TOKEN', {...clone, type:newType, swappedFrom:t.type}); // same id, so it's replaced in place
    setUndo(()=> doAction('PLACE_TOKEN', clone));
  }
}
// "Set Value": type an exact count for a token (any whole number, including
// zero or negative — see SET_TOKEN_COUNT). Enter sets it, Escape cancels.
function openTokenValuePopover(tokenId, clientX, clientY){
  const t = state.tokens.get(tokenId); if(!t) return;
  showTokenValuePopover(t.type, t.count, clientX, clientY, (value)=>{
    const live = state.tokens.get(tokenId);
    if(!live || value===live.count) return;
    const oldCount = live.count;
    doAction('SET_TOKEN_COUNT', {id:tokenId, count:value});
    setUndo(()=> doAction('SET_TOKEN_COUNT', {id:tokenId, count:oldCount}));
  });
}
// The little "type a number" box, calling onSet(wholeNumber). Shared by board
// tokens and hand tokens.
function showTokenValuePopover(type, count, clientX, clientY, onSet){
  const menu = document.getElementById('tokenMenu');
  menu.innerHTML = `
    <div class="popover-row"><label>${escapeHtml(type)}</label><input type="number" id="tokenValueInput" value="${count}" step="1" style="width:90px;"></div>
    <div class="popover-actions"><div class="btn btn-accent btn-sm" id="btnSetTokenValue" style="flex:1;justify-content:center;">Set</div></div>
  `;
  tokenMenuAnchor = {x:clientX, y:clientY}; tokenPlaceAtWorld = null;
  menu.classList.remove('hidden');
  positionMenuNear(menu, tokenMenuAnchorEl());
  const input = document.getElementById('tokenValueInput');
  input.focus(); input.select();
  const apply = ()=>{
    const value = Math.round(Number(input.value));
    menu.classList.add('hidden');
    if(!Number.isFinite(value) || input.value.trim()==='') return;
    onSet(value);
  };
  document.getElementById('btnSetTokenValue').addEventListener('click', (e)=>{ e.stopPropagation(); apply(); });
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); apply(); }
    else if(e.key==='Escape'){ e.preventDefault(); menu.classList.add('hidden'); }
  });
}

