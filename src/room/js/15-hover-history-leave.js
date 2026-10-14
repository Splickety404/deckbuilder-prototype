/* =========================================================================
   HOVER PREVIEW — works identically for board pieces and hand cards; shows
   whatever face is CURRENTLY exposed. Holding the Peek key (A) shows a board
   card's hidden face instead — the only way to peek — and tells the table
   (PEEK_ALERT), same as peeking always has. Scrolling over a card resizes the
   preview. Never shows mid-drag. Sideways art (landscape cards stored in a
   portrait image, see cardArtRotation) is turned upright.
   ========================================================================= */
// Which way a card's FRONT art is printed: an explicit "rotate" column (0/90/180/270, the
// deckbuilder's free-form-game rule) wins; otherwise the game decides (see
// roomServices.cardRotationFor) — the same rules the deckbuilder uses.
function cardArtRotation(r){
  const rot = parseInt(r.rotate, 10);
  if([90,180,270].includes(rot)) return rot;
  return roomServices.cardRotationFor(r);
}
let hoverTimer = null;
const HOVER_PREVIEW_WIDTH = 320; // at preview size 100%
const LS_PREVIEW_SCALE_KEY = 'room_preview_scale';
let previewScale = (()=>{ try{ const v = Number(localStorage.getItem(LS_PREVIEW_SCALE_KEY)); return v>=0.5 && v<=2.5 ? v : 1; }catch(e){ return 1; } })();
let previewTarget = null;   // {get, meta, clientX, clientY} for whatever card the cursor is on
let peekHeld = false;       // the Peek key (A) is down
const peekedThisHold = new Set();
let pointerDragging = false; // a button is down and the mouse has moved — no previews mid-drag
// `meta` = {pieceId, cardIndex} for a card on the board (so a peek can alert
// the table); omitted for your own hand and private search windows.
function wireHoverPreview(el, getCardAndFace, meta){
  el.addEventListener('mouseenter', (ev)=>{
    clearTimeout(hoverTimer);
    previewTarget = {get:getCardAndFace, meta, clientX:ev.clientX, clientY:ev.clientY};
    hoverTimer = setTimeout(renderHoverPreview, peekHeld ? 0 : 400);
  });
  el.addEventListener('mouseleave', ()=>{ clearTimeout(hoverTimer); previewTarget = null; hideHoverPreview(); });
}
function renderHoverPreview(){
  if(!previewTarget || pointerDragging){ hideHoverPreview(); return; }
  const {card, faceUp} = previewTarget.get() || {};
  if(!card){ hideHoverPreview(); return; }
  let showFront = faceUp;
  if(peekHeld){
    // Peek reveals what's hidden: the front of a face-down card, or the back
    // of a face-up double-sided one.
    const hiddenSide = !faceUp || card._doubleSided;
    if(hiddenSide){
      showFront = !faceUp;
      const m = previewTarget.meta;
      if(m){
        const key = m.pieceId+':'+m.cardIndex;
        if(!peekedThisHold.has(key)){ peekedThisHold.add(key); doAction('PEEK_ALERT', {id:m.pieceId, playerName:state.playerName}); }
      }
    }
  }
  showHoverPreview(card, showFront, previewTarget.clientX, previewTarget.clientY);
}
function showHoverPreview(card, faceUp, clientX, clientY){
  if(!card) return;
  const previewEl = document.getElementById('hoverPreview');
  // Size (see previewScale), capped so it always fits on screen, and whether
  // the art is sideways — only the FRONT carries sideways art.
  const maxW = Math.max(120, (window.innerHeight - 170) / 1.4);
  const w = Math.min(HOVER_PREVIEW_WIDTH * previewScale, maxW), h = w * 1.4;
  const rot = (faceUp && !card._classified && !card._pending) ? (card._rotate||0) : 0;
  const sideways = rot===90 || rot===270;
  const frame = document.getElementById('hoverPreviewFrame');
  frame.style.width = (sideways ? h : w)+'px';
  frame.style.height = (sideways ? w : h)+'px';
  // Default position is bottom-right. If that would put the preview under/near
  // the cursor that triggered it, flip it to the left side instead so it never
  // covers what the player is pointing at.
  const wouldOverlapCursor = typeof clientX === 'number' && clientX > (window.innerWidth - (sideways ? h : w) - 60);
  previewEl.classList.toggle('flip-left', wouldOverlapCursor);
  const img = document.getElementById('hoverPreviewImg');
  img.style.width = w+'px'; img.style.height = h+'px';
  img.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
  const back = document.getElementById('hoverPreviewBack');
  back.style.width = w+'px'; back.style.height = h+'px';
  if(card._classified || card._pending){
    img.style.display='none';
    back.textContent = card._pending ? '⏳ Access Pending' : '🔒 Classified';
    back.classList.toggle('classified-face', !!card._classified);
    back.classList.toggle('pending-face', !!card._pending);
    back.style.display='flex';
    previewEl.classList.remove('hidden');
    return;
  }
  back.classList.remove('classified-face','pending-face');
  back.textContent = '🂠';
  const url = faceUp ? card._front : (card._doubleSided && card._back ? card._back : cardBackImageUrl(card));
  if(url){ img.src = sizedUrl(url, 700); img.style.display='block'; back.style.display='none'; }
  else { img.style.display='none'; back.style.display='flex'; }
  previewEl.classList.remove('hidden');
}
function hideHoverPreview(){ document.getElementById('hoverPreview').classList.add('hidden'); }

/* =========================================================================
   HISTORY — fetched fresh from the sheet every time it's opened (the sheet IS
   the source of truth), so it's always complete even for a player who just
   joined or refreshed, browsable all the way back to the start of the game.
   ========================================================================= */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// The old top-toolbar History button opened this as a centered modal; it's
// now a flyout anchored above the chat panel instead (see #historyFlyout),
// opened from #btnChatHistory right next to the chat toggle — still fetched
// fresh from the sheet every time it's opened, same as before.
// The current game's history is kept in this browser as well (small
// pre-rendered rows, per session code), so opening the flyout is instant
// instead of waiting on the sheet: every event this client sees live is
// recorded here as it happens, and a background fetch from the sheet (the
// permanent record, which also covers anything that happened before this
// client joined) fills in the rest and replaces the cache with the complete
// list. Opening the flyout then shows the cache right away and refreshes it.
const LS_HISTORY_PREFIX = 'room_history_';
const HISTORY_CACHE_MAX = 1500;
let historyCache = [], historyCacheCode = null, historyFetchPromise = null;
function historyCacheKey(){ return LS_HISTORY_PREFIX + state.sessionCode; }
function ensureHistoryCache(){
  if(historyCacheCode===state.sessionCode) return;
  historyCacheCode = state.sessionCode;
  historyFetchPromise = null;
  try{ historyCache = JSON.parse(localStorage.getItem(historyCacheKey())||'[]') || []; }catch(e){ historyCache = []; }
}
let historySaveTimer = null;
function saveHistoryCache(){
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(()=>{
    try{
      localStorage.setItem(historyCacheKey(), JSON.stringify(historyCache));
      // keep only the few most recently used games' caches
      const idx = JSON.parse(localStorage.getItem('room_history_index')||'[]').filter(k=>k!==historyCacheKey());
      idx.push(historyCacheKey());
      while(idx.length>5){ try{ localStorage.removeItem(idx.shift()); }catch(e){} }
      localStorage.setItem('room_history_index', JSON.stringify(idx));
    }catch(e){}
  }, 500);
}
function recordHistoryRow(type, payload, playerName, ts){
  if(!state.sessionCode) return;
  ensureHistoryCache();
  historyCache.push({ts: ts||Date.now(), text: describeEvent(type, payload, playerName)});
  if(historyCache.length > HISTORY_CACHE_MAX) historyCache.splice(0, historyCache.length - HISTORY_CACHE_MAX);
  saveHistoryCache();
}
function historyRowHtml(ts, text){
  return `<div class="history-row"><span class="history-time">${new Date(ts).toLocaleTimeString()}</span> ${escapeHtml(text)}</div>`;
}
// Fetches the sheet's full history and makes it the cache (plus any live rows
// newer than the sheet has caught up to). Shared by the flyout and the
// background warm-up so two fetches are never in flight at once.
function refreshHistoryFromSheet(){
  ensureHistoryCache();
  if(historyFetchPromise) return historyFetchPromise;
  const code = state.sessionCode;
  historyFetchPromise = (async ()=>{
    try{
      let events = await roomServices.fetchHistory();
      if(state.sessionCode!==code) return;
      events = (events||[]).filter(ev=> !(ev.payload && ev.payload.quiet)); // live-only updates, summarized by a NOTE — see hotkeyAdjustToken
      const rows = events.map(ev=>({ts:ev.ts, text:describeEvent(ev.type, ev.payload, ev.playerName)}));
      const lastSheet = rows.length ? Math.max(...rows.map(r=>new Date(r.ts).getTime())) : 0;
      const live = historyCache.filter(r=> new Date(r.ts).getTime() > lastSheet + 1500); // not in the sheet yet
      historyCache = rows.concat(live).slice(-HISTORY_CACHE_MAX);
      saveHistoryCache();
    } finally { historyFetchPromise = null; }
  })();
  return historyFetchPromise;
}
// Called once a client has joined, so the sheet's history is already here
// by the time anyone opens the flyout.
function warmHistoryCache(){ if(state.sessionCode) refreshHistoryFromSheet().catch(()=>{}); }
function renderHistoryFlyoutFromCache(){
  const body = document.getElementById('historyFlyoutBody');
  body.innerHTML = historyCache.length ? historyCache.map(r=> historyRowHtml(r.ts, r.text)).join('') : '<p style="color:var(--text-soft);">No events yet.</p>';
  body.scrollTop = body.scrollHeight;
}
async function loadHistoryFlyout(){
  const body = document.getElementById('historyFlyoutBody');
  ensureHistoryCache();
  if(historyCache.length) renderHistoryFlyoutFromCache(); else body.innerHTML = 'Loading…';
  try{
    await refreshHistoryFromSheet();
    if(document.getElementById('historyFlyout').classList.contains('hidden')) return;
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    renderHistoryFlyoutFromCache();
    if(!atBottom) return;
  }catch(e){
    if(!historyCache.length) body.innerHTML = 'Could not load history: '+escapeHtml(e.message);
  }
}
// Live-appends a single new row to the history flyout if it's currently
// open (and always records it in the cache), instead of leaving it as a
// snapshot frozen at whatever moment it was opened. Called for BOTH the
// local player's own actions (announceLocalAction) and everyone else's
// (handleIncomingRoomEvent) — the same two call sites that feed the chat bubbles.
function appendHistoryFlyoutRow(type, payload, playerName, ts){
  recordHistoryRow(type, payload, playerName, ts);
  const flyout = document.getElementById('historyFlyout');
  if(!flyout || flyout.classList.contains('hidden')) return;
  const body = document.getElementById('historyFlyoutBody');
  const emptyMsg = body.querySelector('p');
  if(emptyMsg) body.innerHTML = ''; // "No events yet." placeholder, still showing because this is the very first event since it opened
  const row = document.createElement('div');
  row.className = 'history-row history-row-new';
  row.innerHTML = `<span class="history-time">${new Date(ts||Date.now()).toLocaleTimeString()}</span> ${escapeHtml(describeEvent(type, payload, playerName))}`;
  body.appendChild(row);
  body.scrollTop = body.scrollHeight;
}
function toggleHistoryFlyout(){
  const flyout = document.getElementById('historyFlyout');
  const opening = flyout.classList.contains('hidden');
  flyout.classList.toggle('hidden', !opening);
  if(opening) loadHistoryFlyout();
}
document.getElementById('btnChatHistory').addEventListener('click', toggleHistoryFlyout);
document.getElementById('btnCloseHistoryFlyout').addEventListener('click', ()=>{
  document.getElementById('historyFlyout').classList.add('hidden');
});

/* =========================================================================
   LEAVE GAME — stops syncing and returns to setup. Purely local: nothing is
   deleted from the shared sheet, so the room is exactly as you left it for
   anyone still in it, or for you to rejoin later (name/session code stay
   pre-filled via localStorage for exactly that).
   ========================================================================= */
function leaveGame(){
  teardownRoomChannel();
  state.sessionCode = '';
  state.hasInitialState = false;
  state.pieces.clear();
  state.tokens.clear();
  state.tokenTypes.clear();
  state.tokenTypeStyles.clear();
  state.zones.clear();
  state.tabs = [{id:'main', name:'Table'}]; state.currentTab = 'main';
  state.theme = { boardColor:'#1a1c22', handColor:'#1c1f26' };
  applyBoardTheme(state.theme);
  state.hand = [];
  state.handFaceDown = [];
  state.handTokens.clear();
  state.playerHandCounts.clear();
  state.undoFn = null;
  state.editingZoneId = null;
  state.players.clear();
  state.turnOrder = [];
  state.turnIndex = -1;
  state.selectedIds.clear();
  cancelLongPress();
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('setup-screen').classList.remove('hidden');
}
document.getElementById('btnLeaveGame').addEventListener('click', ()=>{
  if(!confirm('Leave this game? Nothing on the shared room is deleted — you (or anyone else) can rejoin with the same session code any time.')) return;
  leaveGame();
});

// Face-down hand cards: state.handFaceDown runs parallel to state.hand. Every
// change to the hand outside the drag code below only ever adds or removes
// cards at the END (draw, search-to-hand, and their undos), so re-aligning
// by length here — pad new cards as face up, trim removed ones — keeps each
// flag on its own card. The drag code splices both arrays together itself.
function syncHandFaceDown(){
  const f = state.handFaceDown;
  while(f.length < state.hand.length) f.push(false);
  f.length = state.hand.length;
}
function handCardFaceHtml(cardId, faceDown){
  return faceDown ? cardFaceHtml(cardId, false) : cardFrontInnerHtml(cardsById.get(cardId), 300);
}
document.getElementById('handCards').addEventListener('wheel', (e)=>{
  if(!e.target.closest('.hand-card')) return;
  e.preventDefault(); wheelPreviewScale(e);
}, {passive:false});
function renderHand(){
  renderHandTokens();
  syncHandFaceDown();
  const el = document.getElementById('handCards');
  el.innerHTML = state.hand.map((cardId,i)=>{
    const faceDown = state.handFaceDown[i];
    return `<div class="hand-card${faceDown?' face-down':''}" data-idx="${i}" title="Click to flip · drag onto the board to play (press F while dragging to flip it)"><div class="face">${handCardFaceHtml(cardId, faceDown)}</div></div>`;
  }).join('');
  [...el.children].forEach((cardEl,i)=>{
    wireHoverPreview(cardEl, ()=>({card:cardsById.get(state.hand[i]), faceUp:!state.handFaceDown[i]}));
    wireHandCardDrag(cardEl, i);
  });
}
// Left-click a hand card: flip it in place (it then plays face down).
function toggleHandCardFaceDown(idx){
  if(idx >= state.hand.length) return;
  syncHandFaceDown();
  state.handFaceDown[idx] = !state.handFaceDown[idx];
  renderHand();
}
// The hand card currently being dragged out of the hand, if any — lets F flip
// it mid-drag (see the keydown listener below) and keeps F from also flipping
// whatever board card the cursor happens to be over at that moment.
let activeHandDrag = null;
document.addEventListener('keydown', (e)=>{
  if(!activeHandDrag || e.key.toLowerCase()!=='f' || e.ctrlKey || e.metaKey || e.altKey) return;
  if(isTextEntryFocused()) return;
  e.preventDefault();
  activeHandDrag.toggle();
});
// Drag a hand card onto the board to play it — face up, or face down if it
// was flipped in the hand (click it) or F is pressed mid-drag; drag it onto
// another hand card to reorder instead. A small movement threshold avoids
// treating an ordinary click as a drag — a plain click flips the card.
function wireHandCardDrag(el, idx){
  el.addEventListener('mousedown', (e)=>{
    if(e.button!==0) return;
    e.stopPropagation();
    const startX=e.clientX, startY=e.clientY;
    let dragging=false, pick=null, lastEv=null;
    const ghost = el.cloneNode(true); // cloned BEFORE the card ever leaves the hand, so it still shows the right face
    const handGhostWidth = el.getBoundingClientRect().width || 70;
    ghost.classList.add('hand-drop-ghost');
    ghost.removeAttribute('title');
    const ghostHint = document.createElement('div');
    ghostHint.className = 'ghost-hint';
    ghost.appendChild(ghostHint);
    function refreshGhost(){
      ghost.querySelector('.face').innerHTML = handCardFaceHtml(pick.cardId, pick.faceDown);
      ghostHint.textContent = pick.faceDown ? 'F · play face up' : 'F · play face down';
    }
    function onMove(ev){
      lastEv = ev;
      if(!dragging){
        if(Math.abs(ev.clientX-startX)<4 && Math.abs(ev.clientY-startY)<4) return;
        dragging=true; document.body.appendChild(ghost);
        // Picked up — leaves the hand right away (mirrors peeling a card off a
        // board pile, which now also removes on pickup rather than on
        // release), so the hand's own count/layout updates immediately
        // instead of waiting for wherever this drag eventually lands.
        syncHandFaceDown();
        pick = { cardId: state.hand[idx], originalIdx: idx, faceDown: !!state.handFaceDown[idx] };
        state.hand.splice(idx,1);
        state.handFaceDown.splice(idx,1);
        refreshGhost();
        activeHandDrag = { toggle: ()=>{ pick.faceDown = !pick.faceDown; refreshGhost(); if(lastEv) onMove(lastEv); } };
        renderHand();
        syncHandCount();
      }
      // A card played from hand can land directly on a pile, merging into it.
      // Dropped on a SPLAYED pile specifically, it previews a "tuck" at the
      // exact fanned position it would land at (see placePeeledCardToBoard's
      // matching comment for the board-side version of this).
      const boardRect = document.getElementById('boardViewport').getBoundingClientRect();
      const overBoard = ev.clientX>=boardRect.left && ev.clientX<=boardRect.right && ev.clientY>=boardRect.top && ev.clientY<=boardRect.bottom;
      // Over the board the card shows at the size (and angle) it will have once
      // it lands, at the board's current zoom; over the hand, its hand size.
      const gw = overBoard ? PIECE_W*state.view.scale : handGhostWidth;
      ghost.style.setProperty('--hand-card-width', gw+'px'); // .hand-card and its .face size off this
      ghost.style.left = (ev.clientX - gw/2)+'px'; ghost.style.top = (ev.clientY - gw*(PIECE_H/PIECE_W)/2)+'px';
      ghost.style.transform = (overBoard && state.viewRotation) ? `rotate(${state.viewRotation}deg)` : '';
      const target = overBoard ? findOverlapTarget({id:null}, ev.clientX, ev.clientY) : null;
      const sameTurn = canSplayWith(target, 0); // a hand card comes in upright — see canSplayWith
      const splayTarget = sameTurn && target.splayed && target.cardIds.length>1 ? target : null;
      // A hand card has no real piece/board position yet — by convention (see
      // playHandCardToBoard) the cursor's world point stands in for its
      // would-be CENTER, which is exactly what singleOverSingleSplayPreview
      // wants (see its own comment on why it measures a position, not the
      // raw cursor-inside-the-target-box case that under-served this before).
      const world = clientToWorld(ev.clientX, ev.clientY);
      // Same brand-new-splay preview as driveWholePieceDrag's newSplay branch
      // — see singleOverSingleSplayPreview. A hand card is always a lone
      // single card, so the only gate left is the target itself.
      const newSplay = (splayTarget || !sameTurn) ? null : singleOverSingleSplayPreview(target, 1, world.x, world.y);
      if(splayTarget){
        // Same "the card itself tucks in, no separate silhouette" preview as
        // a peeled/whole-piece drag (see driveWholePieceDrag) — the card's
        // real face renders right in its would-land slot inside the splay
        // (see renderBoard), so the cursor-follow ghost is hidden while that's
        // showing instead of both being visible at once.
        clearMergeHighlight();
        // A hand card has no real piece/board position yet — by convention
        // (see playHandCardToBoard) the cursor marks where its CENTER would
        // land if placed standalone, so its would-be top-left corner is half
        // a card up and to the left of that; splayInsertIndex wants that
        // corner, same as every other caller, not the raw cursor point.
        setSplayPreview(splayTarget.id, splayInsertIndex(splayTarget, world.x-PIECE_W/2, world.y-PIECE_H/2), {sourceId:null, cardId:pick.cardId, faceUp:!pick.faceDown, rotation:relCardRotation(splayTarget, 0)});
        ghost.style.visibility = 'hidden';
      } else if(newSplay){
        clearMergeHighlight();
        setSplayPreview(target.id, 0, {sourceId:null, cardId:pick.cardId, faceUp:!pick.faceDown, rotation:relCardRotation(target, 0)}, newSplay);
        ghost.style.visibility = 'hidden';
      } else {
        clearSplayPreview();
        ghost.style.visibility = '';
        if(target) showMergeHighlight(target.id); else clearMergeHighlight();
      }
    }
    function onUp(ev){
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      clearMergeHighlight();
      clearSplayPreview();
      activeHandDrag = null;
      if(!dragging){ toggleHandCardFaceDown(idx); return; }
      ghost.remove();
      const boardRect = document.getElementById('boardViewport').getBoundingClientRect();
      const overBoard = ev.clientX>=boardRect.left && ev.clientX<=boardRect.right && ev.clientY>=boardRect.top && ev.clientY<=boardRect.bottom;
      if(overBoard){
        playHandCardToBoard(pick, ev.clientX, ev.clientY);
      } else {
        // Not over the board — either dropped on another hand card (reorder:
        // insert right before it) or somewhere that isn't a valid target at
        // all (put it back where it started).
        const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetCard = dropEl && dropEl.closest('.hand-card');
        const insertAt = targetCard ? Math.min(Number(targetCard.dataset.idx), state.hand.length) : Math.min(pick.originalIdx, state.hand.length);
        state.hand.splice(insertAt, 0, pick.cardId);
        state.handFaceDown.splice(insertAt, 0, pick.faceDown);
        renderHand();
        syncHandCount();
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
// Places an already-picked-up hand card (see wireHandCardDrag — it already
// left state.hand the moment the drag began) onto the board: merging into
// whatever pile it's dropped on (a SPLAYED target at the exact fanned
// position it was previewing, same as placePeeledCardToBoard; any other target with
// the coarser top/bottom-only rule a whole-piece drop uses), or as a new
// standalone piece if it's not over a pile at all.
function playHandCardToBoard(pick, clientX, clientY){
  const target = findOverlapTarget({id:null}, clientX, clientY);
  const world = clientToWorld(clientX, clientY);
  if(target){
    // Letting go while previewing a brand-new splay (see
    // singleOverSingleSplayPreview/wireHandCardDrag's newSplay branch)
    // creates that splay in the same merge — same as playPieceToBoard/
    // finishWholeMove's matching check.
    const sameTurn = canSplayWith(target, 0); // see canSplayWith
    const newSplayInfo = (!sameTurn || (target.splayed && target.cardIds.length>1)) ? null : singleOverSingleSplayPreview(target, 1, world.x, world.y);
    // Same would-be top-left corner as wireHandCardDrag's matching preview —
    // see its comment.
    const insertIndex = newSplayInfo ? 0
      : (target.splayed && target.cardIds.length>1) ? (sameTurn ? splayInsertIndex(target, world.x-PIECE_W/2, world.y-PIECE_H/2) : target.cardIds.length)
      : (target.cardIds.length>1) ? (shouldInsertBelow(target, world.x, world.y) ? 0 : target.cardIds.length)
      : target.cardIds.length;
    const cardIds = [...target.cardIds.slice(0,insertIndex), pick.cardId, ...target.cardIds.slice(insertIndex)];
    const faceStates = [...target.faceStates.slice(0,insertIndex), !pick.faceDown, ...target.faceStates.slice(insertIndex)];
    const targetCardRotations = target.cardRotations || target.cardIds.map(()=>0);
    const cardRotations = [...targetCardRotations.slice(0,insertIndex), relCardRotation(target, 0), ...targetCardRotations.slice(insertIndex)]; // a hand card always plays in upright
    const splay = newSplayInfo ? { dir: newSplayInfo.dir, spacing: Math.max(SPLAY_MIN, newSplayInfo.spacing) } : null;
    doAction('MERGE_PIECES', { intoId: target.id, cardIds, faceStates, cardRotations, removedId: null, splay, fromHand: pick.faceDown ? 'faceDown' : 'faceUp' });
    return;
  }
  const worldX = world.x - PIECE_W/2, worldY = world.y - PIECE_H/2;
  doAction('PLACE_PIECE', { id:newPieceId(), x:worldX, y:worldY, cardIds:[pick.cardId], faceStates:[!pick.faceDown], owner:state.playerId, fromHand: pick.faceDown ? 'faceDown' : 'faceUp' });
}

