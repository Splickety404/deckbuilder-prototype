/* =========================================================================
   SYNC ENGINE — live game state rides a realtime pub/sub transport (see
   roomServices.syncTransport and the ROOM CHANNEL section): publishing a message
   reaches every other connected client in well under a second, no polling —
   what "feels like you're in the same room" actually requires.

   A durable, permanent history log is written in the background by
   roomServices.logEvent, completely decoupled from the live path (see
   postRoomEvent). If that write is slow or fails, gameplay is unaffected; only
   the "full history" flyout would be missing that one line.

   Optimistic-apply + skip-own-echo: doAction applies locally first (instant
   feel), then publishes; every client (including the sender, if the transport
   echoes your own publishes back to you) runs incoming messages through the same
   skip-if-it's-mine check so nothing is applied twice.
   ========================================================================= */
function isConnected(){ return !!state.sessionCode; }
function postRoomEvent(type, payload){
  if(!isConnected()) return; // playing solo — nothing to sync yet
  const envelope = { ...payload, _origin: state.clientId, _playerName: state.playerName, _playerId: state.playerId };
  // Live transport: instant, this is what everyone actually sees moves through.
  if(transport){
    try{ transport.send(type, envelope); }
    catch(e){ console.error('Live sync publish failed', e); toast('Live sync hiccup — that action may not have reached others.'); }
  }
  // Durable, permanent record only — never on the critical path for gameplay.
  // REQUEST_STATE/STATE_SNAPSHOT are internal plumbing (how a new joiner
  // catches up), not real game moves, so they're not worth logging here.
  if(type==='REQUEST_STATE' || type==='STATE_SNAPSHOT') return;
  roomServices.logEvent(type, envelope);
}
// Fires for every message on the room's channel, including our own
// (a transport may echo a client's own publishes back to it) — the _origin check
// below is what skips re-applying something we already applied optimistically.
function handleIncomingRoomEvent(msg){
  const payload = msg.data || {};
  if(payload._origin === state.clientId) return;
  applyRoomEvent(msg.name, payload);
  if(msg.name==='CHAT' || msg.name==='REQUEST_STATE' || msg.name==='STATE_SNAPSHOT') return;
  if(payload.quiet) return; // synced live, announced later as one summary (see hotkeyAdjustToken)
  showHistoryBubble(describeEvent(msg.name, payload, payload._playerName));
  appendHistoryFlyoutRow(msg.name, payload, payload._playerName, Date.now());
}
function setConnStatus(ok, detail){
  const el = document.getElementById('connStatus');
  el.textContent = ok ? '● connected' : '● having trouble syncing…' + (detail ? ` (${detail})` : '');
  el.title = detail || '';
  el.className = ok ? 'ok' : 'warn';
}

// One call does it all for a state-mutating action: apply locally (instant
// feel), publish it live, done. Every board-changing interaction
// in this app should route through this rather than calling
// applyRoomEvent/postRoomEvent separately.
// Mirrors what handleIncomingRoomEvent does for a REMOTE player's action
// (show a history bubble) but fires instantly for *my own* action instead
// of waiting to see my own event echoed back — CHAT, REQUEST_STATE and
// STATE_SNAPSHOT are exceptions: CHAT already gets its own immediate
// bubble from inside applyRoomEvent's own CHAT case (a second one here
// would double it up), and REQUEST_STATE/STATE_SNAPSHOT are internal
// plumbing for catching a new joiner up, not real game moves worth a
// history entry.
function announceLocalAction(type, payload){
  if(type==='REQUEST_STATE' || type==='STATE_SNAPSHOT') return;
  appendHistoryFlyoutRow(type, payload, state.playerName, Date.now());
  if(type==='CHAT') return;
  showHistoryBubble(describeEvent(type, payload, state.playerName));
}
function doAction(type, payload){
  // New pieces/tokens/zones go on the tab you're looking at (an undo's
  // re-placed clone already carries its own tab).
  if((type==='PLACE_PIECE' || type==='PLACE_TOKEN' || type==='PLACE_ZONE') && payload && payload.tab==null) payload = {...payload, tab:state.currentTab};
  applyRoomEvent(type, payload);
  postRoomEvent(type, payload);
  announceLocalAction(type, payload);
}
// Single-level undo for the local player's own last action. Every user-initiated
// action function calls setUndo() right after performing itself, with a closure
// that knows how to reverse exactly that action (including any hand-side effects
// doAction alone wouldn't know about). Remote events never touch this — undo is
// about "the thing I just did", not a shared/synced timeline.
function setUndo(fn){
  state.undoFn = fn;
  const btn = document.getElementById('btnUndo');
  btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
}
function performUndo(){
  if(!state.undoFn) return;
  const fn = state.undoFn;
  state.undoFn = null; // one level only — undoing clears itself, no redo
  const btn = document.getElementById('btnUndo');
  btn.style.opacity = '.4'; btn.style.pointerEvents = 'none';
  fn();
}
document.getElementById('btnUndo').addEventListener('click', performUndo);
document.addEventListener('keydown', (e)=>{
  if(e.key.toLowerCase()!=='z' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if(isTextEntryFocused()) return; // the chat box keeps its own text undo
  if(!document.getElementById('game-screen').classList.contains('active')) return;
  e.preventDefault();
  performUndo();
});
// For actions with no board-state change at all (peek) — just a synced note that
// shows as a toast for other players and appears in the browsable history.
function doNote(text){
  postRoomEvent('NOTE', {text});
  announceLocalAction('NOTE', {text});
}

/* ROTATION MODEL — a card's on-screen angle (before the board view's own
   rotation) is ALWAYS its pile's `rotation` plus that card's entry in the
   pile's `cardRotations`, in every render path (unsplayed, splayed, splay
   previews). A lone card keeps all of its angle in `rotation` with
   cardRotations [0] (see normalizeSingleCardRotation), and whenever a card
   changes piles its absolute angle is preserved (absCardRotation/
   relCardRotation). Previously the two were combined differently in
   different places, so a card could carry a hidden leftover rotation that
   suddenly showed up — e.g. while hovering one card over another. */
function normAngle(deg){ return ((Math.round(deg) % 360) + 360) % 360; }
function absCardRotation(p, i){ return normAngle((p.rotation||0) + ((p.cardRotations||[])[i]||0)); }
function relCardRotation(targetPiece, absDeg){ return normAngle(absDeg - (targetPiece.rotation||0)); }
function normalizeSingleCardRotation(p){
  if(!p || p.kind==='image' || !p.cardIds || p.cardIds.length!==1) return;
  p.rotation = absCardRotation(p, 0);
  p.cardRotations = [0];
}
function setPieceCards(id, cardIds, faceStates, cardRotations){
  const p = state.pieces.get(id);
  if(!p) return;
  if(!cardIds.length){ state.pieces.delete(id); return; }
  p.cardIds = cardIds; p.faceStates = faceStates;
  // A pile that's been whittled down to exactly one card (peeled/drawn/
  // searched down from a splayed pile, most commonly) is no longer really
  // "splayed" — renderBoard already knows this (its splay branch is gated on
  // `p.splayed && p.cardIds.length>1`, so a lone leftover card already LOOKS
  // like a normal single card) but p.splayed itself was left sitting at
  // true, a stale flag nothing was clearing. A card merged back onto it
  // later inherited that stale flag (see MERGE_PIECES: it only ever sets
  // splayed TRUE for a fresh splay, never explicitly clears it), so it
  // instantly became part of a "splayed" 2-card pile instead of an ordinary
  // stack. Clearing it here, the one place every card-count change funnels
  // through, is what actually keeps a lone card behaving like one.
  if(cardIds.length<=1) p.splayed = false;
  // Per-card rotation (see ROTATE_CARD) — a splayed pile's cards can each be
  // rotated independently, so whenever a pile's card array is rebuilt this
  // parallel array has to travel along with it, same as faceStates already
  // does, or every card would silently reset to upright. Falls back to all-
  // upright only when the caller genuinely has nothing to say about it.
  p.cardRotations = cardRotations || cardIds.map(()=>0);
  normalizeSingleCardRotation(p); // a lone leftover card folds its own angle into the piece's
}

// The single place board state actually changes — used for both our own actions
// (optimistic, immediate) and replayed remote events, so every client converges.
function applyRoomEvent(type, payload){
  // Captured BEFORE the reducer below mutates state — rotatePopEl (see its
  // own comment, near popInEl) needs the pre-mutation angle to animate FROM,
  // and by the time this function would otherwise get a chance to look, the
  // mutation below has already overwritten it.
  let rotateFromDeg = null;
  if(type==='ROTATE_PIECE'){
    const p = state.pieces.get(payload.id);
    if(p) rotateFromDeg = p.rotation||0;
  } else if(type==='ROTATE_CARD'){
    const p = state.pieces.get(payload.id);
    if(p) rotateFromDeg = (p.cardRotations && p.cardRotations[payload.cardIndex]) || 0;
  }
  // Same reasoning, for flipPopEl: the OLD face, rendered as its own HTML
  // snapshot rather than just a boolean, so the animation has something to
  // actually show during the first half (see flipPopEl's own comment on why
  // that first half briefly shows this stale content on purpose).
  let flipOldFaceHtml = null;
  if(type==='FLIP_TOP'){
    const p = state.pieces.get(payload.id);
    if(p && p.faceStates.length){
      const idx = payload.cardIndex!=null ? payload.cardIndex : p.faceStates.length-1;
      if(idx>=0 && idx<p.cardIds.length) flipOldFaceHtml = cardFaceHtml(p.cardIds[idx], p.faceStates[idx]);
    }
  }
  switch(type){
    case 'PLACE_PIECE': {
      // kind defaults to 'cards' (an ordinary fixed-size card stack). kind:'image' is a
      // player-uploaded custom piece instead — no cardIds/faceStates, its own w/h (any
      // scale the uploader picked) and naturalW/naturalH (for aspect-locked resizing later).
      state.pieces.set(payload.id, { id:payload.id, x:payload.x, y:payload.y, cardIds:payload.cardIds||[], faceStates:payload.faceStates||[],
        // cardRotations is per-card rotation, independent of the piece-level
        // `rotation` below — only ever visually meaningful for a SPLAYED
        // multi-card pile (see renderBoard/rotatePiece); an unsplayed or
        // single-card piece just rotates as a whole via `rotation` instead.
        cardRotations: payload.cardRotations || (payload.cardIds||[]).map(()=>0),
        owner:payload.owner, splayed:false, splayDir:'right', splaySpacing:36, label:payload.label||'', rotation:payload.rotation||0, locked:payload.locked||false,
        tab:payload.tab||'main',
        kind:payload.kind||'cards', imageUrl:payload.imageUrl||null, w:payload.w||null, h:payload.h||null, naturalW:payload.naturalW||null, naturalH:payload.naturalH||null });
      // A lone card's angle lives entirely in `rotation` (see ROTATION MODEL).
      // Older versions sent the same angle in both fields; what showed was
      // `rotation`, so that's what's kept.
      { const np = state.pieces.get(payload.id); if(np.cardIds.length===1) np.cardRotations = [0]; }
      if(payload.deckRecord) state.deckRecords.set(payload.deckRecord.id, {...payload.deckRecord, pieceId: payload.id});
      if(payload.sourceSheets && payload.sourceSheets.length){
        // fire-and-forget: this piece renders with "Access Pending" faces until
        // whichever sheets it needs finish loading, then a re-render picks up
        // the real art (or "Classified", if this account isn't authorized).
        registerPendingCards(payload.cardIds);
        ensureSheetsLoaded(payload.sourceSheets).then(renderBoard);
      }
      break;
    }
    case 'SET_PIECE_SCALE': {
      const p = state.pieces.get(payload.id);
      if(p){ p.w = payload.w; p.h = payload.h; }
      break;
    }
    case 'MOVE_PIECE': {
      const p = state.pieces.get(payload.id);
      if(p){ p.x = payload.x; p.y = payload.y; }
      break;
    }
    case 'FLIP_TOP': {
      const p = state.pieces.get(payload.id);
      if(p && p.faceStates.length){
        // cardIndex is new (see flipTopCard) — absent on an older/replayed
        // event, which always meant "the top card" anyway.
        const idx = payload.cardIndex!=null ? payload.cardIndex : p.faceStates.length-1;
        if(idx>=0 && idx<p.faceStates.length) p.faceStates[idx] = payload.faceUp;
      }
      break;
    }
    case 'REMOVE_PIECE': {
      state.pieces.delete(payload.id);
      break;
    }
    case 'MERGE_PIECES': {
      setPieceCards(payload.intoId, payload.cardIds, payload.faceStates, payload.cardRotations);
      state.pieces.delete(payload.removedId);
      // See mergePieceOntoTarget's splayInfo param: hovering a single card
      // over another single card, nudged far enough off-center, creates a
      // brand-new splay in the same atomic event as the merge itself.
      if(payload.splay){
        const into = state.pieces.get(payload.intoId);
        if(into){ into.splayed = true; into.splayDir = payload.splay.dir; into.splaySpacing = payload.splay.spacing; }
      }
      break;
    }
    case 'SHUFFLE_PIECE':
    case 'REORDER_PIECE': // a pile browser moved one card (see moveCardWithinPile)
    case 'FLIP_STACK': {
      setPieceCards(payload.id, payload.cardIds, payload.faceStates, payload.cardRotations);
      break;
    }
    case 'SET_SPLAY': {
      const p = state.pieces.get(payload.id);
      if(p){
        p.splayed = payload.splayed;
        if(payload.dir) p.splayDir = payload.dir;
        if(payload.spacing) p.splaySpacing = payload.spacing;
      }
      break;
    }
    case 'ROTATE_PIECE': {
      const p = state.pieces.get(payload.id);
      if(p) p.rotation = payload.rotation;
      break;
    }
    // Rotates exactly ONE card within a pile in place — used instead of
    // ROTATE_PIECE while hovering a specific card of a SPLAYED pile (see
    // rotatePiece), so R only spins the card under the cursor rather than
    // the whole stack.
    case 'ROTATE_CARD': {
      const p = state.pieces.get(payload.id);
      if(p){
        if(!p.cardRotations) p.cardRotations = p.cardIds.map(()=>0);
        if(payload.cardIndex>=0 && payload.cardIndex<p.cardRotations.length) p.cardRotations[payload.cardIndex] = payload.rotation;
      }
      break;
    }
    case 'SET_LABEL': {
      const p = state.pieces.get(payload.id);
      if(p) p.label = payload.label;
      break;
    }
    case 'SEARCH_REMOVE':
    case 'DRAW_TOP':
    case 'REMOVE_CARD': { // REMOVE_CARD (see removeCard): a single card discarded outright, no hand/board destination
      setPieceCards(payload.id, payload.remainingCardIds, payload.remainingFaceStates, payload.remainingCardRotations);
      break;
    }
    case 'RESTORE_PIECE_CARDS': { // internal — used only to power undo
      setPieceCards(payload.id, payload.cardIds, payload.faceStates, payload.cardRotations);
      break;
    }
    case 'PLACE_TOKEN': {
      state.tokens.set(payload.id, {id:payload.id, x:payload.x, y:payload.y, type:payload.type, count:payload.count, attachedTo:payload.attachedTo||null, tab:payload.tab||'main',
        attachedCardIndex: (payload.attachedTo && payload.attachedCardIndex!=null) ? payload.attachedCardIndex : null});
      break;
    }
    case 'MOVE_TOKEN': {
      const t = state.tokens.get(payload.id);
      if(t){
        t.x=payload.x; t.y=payload.y; t.attachedTo=payload.attachedTo||null;
        // Which specific card (within the host pile) this token rides —
        // null for a lone freestanding token, or when attaching to a piece
        // that isn't a card pile at all (e.g. an image). See attachedTokenPos.
        t.attachedCardIndex = (payload.attachedTo && payload.attachedCardIndex!=null) ? payload.attachedCardIndex : null;
      }
      break;
    }
    // Seth: tokens can now sit at zero or go negative (a damage/life counter,
    // not just a physical stack of chips) — count is no longer auto-deleted
    // just for reaching zero or below. A token is only ever actually removed
    // by an explicit REMOVE_TOKEN (the radial menu's "Remove All").
    case 'SET_TOKEN_COUNT': {
      const t = state.tokens.get(payload.id);
      if(t) t.count = payload.count;
      break;
    }
    case 'REMOVE_TOKEN': {
      state.tokens.delete(payload.id);
      break;
    }
    case 'HAND_COUNT': {
      state.playerHandCounts.set(payload.playerId, {playerName:payload.playerName, count:payload.count, tokens:payload.tokens||{}});
      renderPlayerCounters();
      break;
    }
    case 'DEFINE_TOKEN_TYPE': {
      state.tokenTypes.set(payload.name, payload.color);
      setTokenTypeStyle(payload.name, payload);
      break;
    }
    // Editing an EXISTING token type (see openTokenTypeEditor) rather than
    // defining a new one. A placed token references its type by NAME
    // (t.type), looked up live against state.tokenTypes at render time (see
    // renderTokens) rather than a copied color snapshot — so a pure color
    // edit already shows up on every already-placed token of this type for
    // free, just by overwriting the map entry below, no further work needed.
    // Renaming is the one case that needs help: the name IS the map key, and
    // every placed token's own t.type field still holds the OLD name after
    // the key changes — left alone, they'd silently stop resolving to any
    // color/letter at all the moment their old key disappears. So a rename
    // also walks every placed token and repoints it to the new name.
    case 'EDIT_TOKEN_TYPE': {
      if(payload.oldName !== payload.name){
        state.tokenTypes.delete(payload.oldName);
        state.tokenTypeStyles.delete(payload.oldName);
        state.tokens.forEach(t=>{ if(t.type===payload.oldName) t.type = payload.name; });
        // Renamed tokens in your own hand, and in everyone's public counts, too.
        if(state.handTokens.has(payload.oldName)){
          state.handTokens.set(payload.name, (state.handTokens.get(payload.name)||0) + state.handTokens.get(payload.oldName));
          state.handTokens.delete(payload.oldName);
        }
        state.playerHandCounts.forEach(info=>{
          if(info.tokens && info.tokens[payload.oldName]!=null){
            info.tokens[payload.name] = (info.tokens[payload.name]||0) + info.tokens[payload.oldName];
            delete info.tokens[payload.oldName];
          }
        });
      }
      state.tokenTypes.set(payload.name, payload.color);
      setTokenTypeStyle(payload.name, payload);
      renderHandTokens(); renderPlayerCounters(); // new name/color on the hand tray and player chips
      break;
    }
    case 'PLACE_ZONE': {
      state.zones.set(payload.id, { id:payload.id, x:payload.x, y:payload.y, w:payload.w, h:payload.h,
        color:payload.color, strokeColor:payload.strokeColor, strokeWidth:payload.strokeWidth,
        label:payload.label||'', snapMode:payload.snapMode||'none', locked:payload.locked||false,
        opacity: payload.opacity!=null ? payload.opacity : ZONE_DEFAULT_OPACITY, tab: payload.tab||'main' });
      break;
    }
    case 'SET_PIECE_LOCK': {
      const p = state.pieces.get(payload.id);
      if(p) p.locked = payload.locked;
      break;
    }
    case 'SET_ZONE_LOCK': {
      const z = state.zones.get(payload.id);
      if(z) z.locked = payload.locked;
      break;
    }
    case 'SET_ZONE_RECT': {
      const z = state.zones.get(payload.id);
      if(z){ z.x=payload.x; z.y=payload.y; z.w=payload.w; z.h=payload.h; }
      break;
    }
    // ---- Board tabs (see TABS). Tabs themselves are shared; which one you're
    // looking at is yours alone (state.currentTab).
    case 'ADD_TAB': {
      if(!state.tabs.some(t=>t.id===payload.id)) state.tabs.push({id:payload.id, name:payload.name});
      break;
    }
    case 'RENAME_TAB': {
      const t = state.tabs.find(t=>t.id===payload.id); if(t) t.name = payload.name;
      break;
    }
    case 'REMOVE_TAB': {
      if(payload.id==='main') break;
      state.tabs = state.tabs.filter(t=>t.id!==payload.id);
      if(state.currentTab===payload.id) state.currentTab = 'main';
      break;
    }
    case 'SET_TAB': { // moves one piece/token/zone to another tab
      const m = payload.kind==='piece' ? state.pieces : payload.kind==='token' ? state.tokens : state.zones;
      const o = m.get(payload.id);
      if(o) o.tab = payload.tab;
      if(payload.kind==='piece') state.selectedIds.delete(payload.id);
      if(payload.kind==='token') state.selectedTokenIds.delete(payload.id);
      break;
    }
    case 'SET_ZONE_STYLE': {
      const z = state.zones.get(payload.id);
      if(z){
        if(payload.color!==undefined) z.color = payload.color;
        if(payload.strokeColor!==undefined) z.strokeColor = payload.strokeColor;
        if(payload.strokeWidth!==undefined) z.strokeWidth = payload.strokeWidth;
        if(payload.label!==undefined) z.label = payload.label;
        if(payload.snapMode!==undefined) z.snapMode = payload.snapMode;
        if(payload.opacity!==undefined) z.opacity = payload.opacity;
      }
      break;
    }
    case 'REMOVE_ZONE': {
      state.zones.delete(payload.id);
      break;
    }
    case 'SET_THEME': {
      state.theme = { boardColor: payload.boardColor, handColor: payload.handColor };
      applyBoardTheme(state.theme);
      break;
    }
    case 'LOAD_LAYOUT': {
      state.pieces.clear(); state.tokens.clear(); state.zones.clear(); state.tokenTypes.clear(); state.tokenTypeStyles.clear();
      state.deckRecords.clear(); (payload.deckRecords||[]).forEach(r=> state.deckRecords.set(r.id, {...r}));
      state.gameFolderId = payload.gameFolderId || '';
      (payload.tokenTypes||[]).forEach(([name,color])=> state.tokenTypes.set(name,color));
      (payload.tokenTypeStyles||[]).forEach(([name,st])=> setTokenTypeStyle(name, st));
      state.tabs = (payload.tabs && payload.tabs.length) ? payload.tabs.map(t=>({...t})) : [{id:'main', name:'Table'}];
      if(!state.tabs.some(t=>t.id===state.currentTab)) state.currentTab = 'main';
      (payload.zones||[]).forEach(z=> state.zones.set(z.id, {...z}));
      (payload.pieces||[]).forEach(p=>{ const np = {...p}; if(np.cardIds && np.cardIds.length===1) np.cardRotations = [0]; state.pieces.set(p.id, np); }); // see ROTATION MODEL
      (payload.tokens||[]).forEach(t=> state.tokens.set(t.id, {...t}));
      if(payload.theme){ state.theme = {...payload.theme}; applyBoardTheme(state.theme); }
      if(payload.sourceSheets && payload.sourceSheets.length){
        registerPendingCards((payload.pieces||[]).flatMap(p=>p.cardIds||[]));
        ensureSheetsLoaded(payload.sourceSheets).then(renderBoard);
      }
      break;
    }
    case 'PLAYER_JOINED': {
      state.players.set(payload.playerId, payload.playerName);
      renderTurnTracker();
      break;
    }
    case 'SET_TURN': {
      state.turnOrder = payload.turnOrder;
      state.turnIndex = payload.turnIndex;
      renderTurnTracker();
      break;
    }
    case 'PING': {
      if((payload.tab||'main')!==state.currentTab) break; // pinged somewhere on another tab
      showPing(payload.x, payload.y);
      if(payload.pieceId && state.pieces.has(payload.pieceId)) flashPingHighlight(payload.pieceId, payload.cardIndex);
      break;
    }
    case 'ROLL_DICE': {
      showDiceResult(payload.sides, payload.result);
      break;
    }
    case 'CHAT': {
      showChatBubble(payload.playerName, payload.text);
      break;
    }
    case 'NOTE': break; // no board mutation — handled entirely via the toast/history text
    // Anti-cheat visibility (a peek — holding A over a card — is never quiet): a brief, unmissable
    // flag on the exact pile that was just peeked at, for every player —
    // self-clears after PEEK_ALERT_MS via its own timeout, not another event,
    // so it works even if the peeking player leaves right after.
    case 'PEEK_ALERT': {
      const p = state.pieces.get(payload.id);
      if(p){
        const b = pieceBounds(p);
        showPing(b.x+b.w/2, b.y+b.h/2);
      }
      state.peekAlertIds.add(payload.id);
      setTimeout(()=>{ state.peekAlertIds.delete(payload.id); renderBoard(); }, PEEK_ALERT_MS);
      break;
    }
    // Anti-cheat visibility for Search — persistent (not a timed flash like
    // PEEK_ALERT above) for as long as the searching player's modal stays
    // open, since a search can take a while and should stay obviously
    // flagged the whole time, not just at the start.
    case 'SEARCH_START': {
      // What the pile's badge says (see renderBoard) — a full search, or just the top few.
      state.searchingBy.set(payload.id, payload.count ? `👁 ${payload.playerName} is looking at the top ${payload.count}` : `🔍 ${payload.playerName} is searching`);
      break;
    }
    case 'SEARCH_END': {
      state.searchingBy.delete(payload.id);
      break;
    }
    // Lets a newly-joined (or refreshed) player catch up to the live board
    // without the sheet ever being in the loop. Any client that already has
    // real state answers, after a small random delay so simultaneous
    // responses don't all collide — duplicate answers are harmless (a
    // requester just re-applies the same snapshot again). Purely a peer
    // hand-off: nothing here is logged as permanent history (see
    // postRoomEvent/announceLocalAction's exclusions for these two types).
    case 'REQUEST_STATE': {
      if(state.hasInitialState && payload.requesterId && payload.requesterId !== state.playerId){
        setTimeout(()=>{
          doAction('STATE_SNAPSHOT', { to: payload.requesterId, ...exportLayout(),
            players: [...state.players.entries()], turnOrder: state.turnOrder, turnIndex: state.turnIndex });
        }, 150 + Math.random()*350);
      }
      break;
    }
    case 'STATE_SNAPSHOT': {
      if(payload.to !== state.playerId) break; // addressed to a different requester — not for us
      state.pieces.clear(); state.tokens.clear(); state.zones.clear(); state.tokenTypes.clear(); state.tokenTypeStyles.clear();
      state.deckRecords.clear(); (payload.deckRecords||[]).forEach(r=> state.deckRecords.set(r.id, {...r}));
      state.gameFolderId = payload.gameFolderId || '';
      (payload.tokenTypes||[]).forEach(([name,color])=> state.tokenTypes.set(name,color));
      (payload.tokenTypeStyles||[]).forEach(([name,st])=> setTokenTypeStyle(name, st));
      state.tabs = (payload.tabs && payload.tabs.length) ? payload.tabs.map(t=>({...t})) : [{id:'main', name:'Table'}];
      if(!state.tabs.some(t=>t.id===state.currentTab)) state.currentTab = 'main';
      (payload.zones||[]).forEach(z=> state.zones.set(z.id, {...z}));
      (payload.pieces||[]).forEach(p=>{ const np = {...p}; if(np.cardIds && np.cardIds.length===1) np.cardRotations = [0]; state.pieces.set(p.id, np); }); // see ROTATION MODEL
      (payload.tokens||[]).forEach(t=> state.tokens.set(t.id, {...t}));
      if(payload.theme){ state.theme = {...payload.theme}; applyBoardTheme(state.theme); }
      if(payload.players) payload.players.forEach(([pid,name])=> state.players.set(pid, name));
      if(payload.turnOrder) state.turnOrder = payload.turnOrder;
      if(payload.turnIndex!=null) state.turnIndex = payload.turnIndex;
      state.hasInitialState = true; warmHistoryCache();
      state.lastSnapshotAt = Date.now(); // see waitForRoomState
      if(payload.sourceSheets && payload.sourceSheets.length){
        registerPendingCards((payload.pieces||[]).flatMap(p=>p.cardIds||[]));
        ensureSheetsLoaded(payload.sourceSheets).then(renderBoard);
      }
      renderTurnTracker();
      renderPlayerCounters();
      break;
    }
  }
  if(['ADD_TAB','RENAME_TAB','REMOVE_TAB','SET_TAB','PLACE_PIECE','MOVE_PIECE','FLIP_TOP','ROTATE_PIECE','ROTATE_CARD','REMOVE_PIECE','MERGE_PIECES','SHUFFLE_PIECE','REORDER_PIECE','FLIP_STACK','SET_SPLAY','SET_LABEL','SEARCH_REMOVE','DRAW_TOP','REMOVE_CARD','RESTORE_PIECE_CARDS','PLACE_TOKEN','MOVE_TOKEN','SET_TOKEN_COUNT','SET_TOKEN_SPLAY','REMOVE_TOKEN','DEFINE_TOKEN_TYPE','EDIT_TOKEN_TYPE','PLACE_ZONE','SET_ZONE_RECT','SET_ZONE_STYLE','REMOVE_ZONE','LOAD_LAYOUT','SET_PIECE_LOCK','SET_ZONE_LOCK','SET_PIECE_SCALE','STATE_SNAPSHOT','PEEK_ALERT','SEARCH_START','SEARCH_END'].includes(type)) renderBoard();
  // A playful "pop" the moment something new lands on the board — for every client,
  // local placer and remote viewers alike, since this runs from inside applyRoomEvent
  // itself rather than the call site. Only ever added to a piece/token/zone element
  // right after it was (re)built, never a blanket per-render animation (renderBoard()
  // fully rebuilds the board on every change, so an unconditional entrance animation
  // on .piece/.token/.zone would replay for EVERYTHING on EVERY unrelated action).
  if(type==='PLACE_PIECE') popInEl('piece', payload.id);
  if(type==='PLACE_TOKEN') popInEl('token', payload.id);
  if(type==='PLACE_ZONE') popInEl('zone', payload.id);
  // Same "runs from inside applyRoomEvent itself, so every client sees it,
  // not just whoever pressed the key" reasoning as popInEl above — a card
  // flip or a piece/card rotation is exactly the kind of tactile moment that
  // deserves the same playfulness as everything else in this app (see
  // --bounce and, again, popInEl).
  if(type==='FLIP_TOP') flipPopEl(payload.id, payload.cardIndex, flipOldFaceHtml);
  if(type==='ROTATE_PIECE' && rotateFromDeg!=null){
    rotatePopEl(document.querySelector(`.piece[data-id="${payload.id}"]`), rotateFromDeg, payload.rotation);
  }
  if(type==='ROTATE_CARD' && rotateFromDeg!=null){
    rotatePopEl(document.querySelector(`.piece[data-id="${payload.id}"] .splay-card[data-i="${payload.cardIndex}"]`), rotateFromDeg, payload.rotation);
  }
}
function popInEl(cssClass, id){
  const el = document.querySelector(`.${cssClass}[data-id="${id}"]`);
  if(!el) return;
  el.classList.add('pop-in');
  setTimeout(()=> el.classList.remove('pop-in'), 380);
}
// A quick squash-and-recover on the exact face that just flipped — the pile's
// own single face (an unsplayed pile, or a lone card) or, for one card picked
// out of a splay, that specific .splay-card. Built with the Web Animations
// API rather than a baked CSS class (see popInEl's comment on why one-shot
// animations can't just live in renderBoard's className template) for a
// second reason beyond the one-shot problem: a splayed card's own element
// already carries its own per-card rotation as an inline `transform` (see
// renderBoard's rotStyle) that a plain CSS @keyframes class targeting
// `transform` would stomp on for the animation's duration, snapping the card
// upright and back. Building the squash out of full `rotate(...) scaleX(...)`
// keyframes instead lets it carry that same base rotation all the way
// through, and el.animate() cleanly hands control back to the element's own
// (unchanged) inline style the instant it finishes.
function flipPopEl(pieceId, cardIndex, oldFaceHtml){
  const p = state.pieces.get(pieceId);
  if(!p) return;
  let el, baseRotation = 0;
  if(p.splayed && p.cardIds.length>1 && cardIndex!=null){
    el = document.querySelector(`.piece[data-id="${pieceId}"] .splay-card[data-i="${cardIndex}"]`);
    baseRotation = (p.cardRotations && p.cardRotations[cardIndex]) || 0;
  } else {
    el = document.querySelector(`.piece[data-id="${pieceId}"] .piece-face`);
    baseRotation = (p.cardRotations && p.cardRotations[p.cardIds.length-1]) || 0; // an unsplayed pile's top card can carry its own angle — see ROTATION MODEL
  }
  if(!el || !el.animate) return;
  // renderBoard() already drew the NEW face into el by the time this runs
  // (it's called right after the state mutation + render, same as
  // popInEl/rotatePopEl) — so without this, a "flip" would just be a squash
  // squeezed around a face that already changed at t=0, not at the visual
  // midpoint where a real card's edge-on moment actually hides which way
  // it's showing. oldFaceHtml (a snapshot taken BEFORE the mutation, see
  // applyRoomEvent) lets this briefly put the OLD face back for the
  // animation's first half, then swap to the real (already-rendered) new
  // face — swapping DOM content, not just a CSS trick, since the two faces
  // are genuinely different images/text, not something a single element's
  // style alone can cross-fade or reveal.
  const newFaceHtml = el.innerHTML;
  const duration = 180; // quick and snappy, in line with the rotate animation
  if(oldFaceHtml!=null){
    el.innerHTML = oldFaceHtml;
    setTimeout(()=>{ if(el.isConnected) el.innerHTML = newFaceHtml; }, duration/2);
  }
  const base = `rotate(${baseRotation}deg)`;
  el.animate([
    { transform: `${base} scaleX(1)` },
    { transform: `${base} scaleX(0)` },
    { transform: `${base} scaleX(1)` },
  ], { duration, easing:'ease-in-out' });
}
// The signed, shortest-path turn that actually connects two 90°-multiple
// angles — e.g. 270→0 is a +90 step (the pile spun forward past 360, not
// backward through 180), which plain `to-from` arithmetic gets wrong right
// at that wraparound. rotateCardAt/rotatePiece only ever move a pile by
// exactly one 90° tap at a time, so the "shortest" path here is always
// exactly the real one that was taken.
function shortestRotationDelta(fromDeg, toDeg){
  let d = ((toDeg-fromDeg)%360+360)%360;
  if(d>180) d -= 360;
  return d;
}
// The bounce-overshoot spin for a whole-piece (ROTATE_PIECE) or single-card
// (ROTATE_CARD) tap — same idea as flipPopEl (see its comment on why this is
// built with full explicit `rotate(...)` keyframes via el.animate() rather
// than a CSS class): `fromDeg`/`toDeg` are the plain 0/90/180/270 values
// state actually stores, but the animation itself travels the CONTINUOUS,
// un-wrapped path between them (via shortestRotationDelta) so a 270→0 tap
// visibly keeps spinning forward past 360° instead of snapping backward
// through 180 — and swings a little past its landing angle before settling,
// the same --bounce overshoot feel used everywhere else in this app.
function rotatePopEl(el, fromDeg, toDeg){
  if(!el || !el.animate) return;
  const delta = shortestRotationDelta(fromDeg, toDeg);
  const target = fromDeg + delta;
  const overshoot = target + (delta<0 ? -14 : 14);
  el.animate([
    { transform: `rotate(${fromDeg}deg)` },
    { transform: `rotate(${overshoot}deg)` },
    { transform: `rotate(${target}deg)` },
  ], { duration:260, easing:'cubic-bezier(.34,1.56,.64,1)' }); // same curve as --bounce
}

// Human-readable text for a synced event — used for the chat's history bubbles
// (remote events only, see showHistoryBubble) and for the on-demand full
// history flyout (see loadHistoryFlyout()).
function describeEvent(type, payload, playerName){
  switch(type){
    case 'PLACE_PIECE': if(payload.fromHand) return `${playerName} played a card from hand${payload.fromHand==='faceDown'?' face down':''}`;
      return payload.kind==='image' ? `${playerName} placed a custom piece` : `${playerName} placed a pile (${(payload.cardIds||[]).length} cards)`;
    case 'MOVE_PIECE': return `${playerName} moved a pile`;
    case 'FLIP_TOP': return `${playerName} flipped a card ${payload.faceUp?'face up':'face down'}`;
    case 'REMOVE_PIECE': return `${playerName} removed a pile from the board`;
    case 'MERGE_PIECES': return payload.fromHand ? `${playerName} played a card from hand onto a pile${payload.fromHand==='faceDown'?' face down':''}` : `${playerName} combined two piles`;
    case 'SHUFFLE_PIECE': return `${playerName} shuffled a pile`;
    case 'FLIP_STACK': return `${playerName} flipped a stack over`;
    case 'SET_SPLAY': return `${playerName} ${payload.splayed?`splayed a pile (${payload.dir||'right'})`:'unsplayed a pile'}`;
    case 'ROTATE_PIECE': return `${playerName} rotated a pile to ${payload.rotation}°`;
    case 'ROTATE_CARD': return `${playerName} rotated a card in a pile`;
    case 'SET_LABEL': return `${playerName} labeled a pile "${payload.label}"`;
    case 'PLACE_TOKEN': return payload.swappedFrom ? `${playerName} swapped a ${payload.swappedFrom} token for ${payload.type}` : `${playerName} placed a ${payload.type} token`;
    case 'MOVE_TOKEN': return `${playerName} moved a token`;
    case 'SET_TOKEN_COUNT': return `${playerName} set a token count to ${payload.count}`;
    case 'REMOVE_TOKEN': return `${playerName} removed a token`;
    case 'HAND_COUNT': return payload.tokenNote ? `${playerName} ${payload.tokenNote}` : `${playerName} now has ${payload.count} card(s) in hand`;
    case 'SEARCH_REMOVE': return `${playerName} searched a pile and took ${payload.removedCount} card(s)`;
    case 'RESTORE_PIECE_CARDS': return `${playerName} undid a change to a pile`;
    case 'DRAW_TOP': return payload.count>1 ? `${playerName} drew ${payload.count} cards from a pile` : `${playerName} took the top card of a pile`;
    case 'REMOVE_CARD': return `${playerName} removed a card from a pile`;
    case 'DEFINE_TOKEN_TYPE': return `${playerName} defined a "${payload.name}" token type`;
    case 'EDIT_TOKEN_TYPE': return payload.oldName!==payload.name
      ? `${playerName} renamed the "${payload.oldName}" token type to "${payload.name}"`
      : `${playerName} edited the "${payload.name}" token type`;
    case 'PLACE_ZONE': return `${playerName} created a zone${payload.label?` "${payload.label}"`:''}`;
    case 'SET_ZONE_RECT': return `${playerName} resized/moved a zone`;
    case 'SET_ZONE_STYLE': return `${playerName} edited a zone`;
    case 'ADD_TAB': return `${playerName} added a board tab "${payload.name}"`;
    case 'RENAME_TAB': return `${playerName} renamed a board tab to "${payload.name}"`;
    case 'REMOVE_TAB': return `${playerName} removed a board tab`;
    case 'SET_TAB': return `${playerName} moved ${payload.kind==='piece'?'a pile':payload.kind==='token'?'a token':'a zone'} to the "${tabName(payload.tab)}" tab`;
    case 'REMOVE_ZONE': return `${playerName} deleted a zone`;
    case 'SET_THEME': return `${playerName} changed the table theme`;
    case 'LOAD_LAYOUT': return `${playerName} loaded a saved board layout`;
    case 'SET_PIECE_LOCK': return `${playerName} ${payload.locked?'locked':'unlocked'} a pile`;
    case 'SET_PIECE_SCALE': return `${playerName} resized a custom piece`;
    case 'SET_ZONE_LOCK': return `${playerName} ${payload.locked?'locked':'unlocked'} a zone`;
    case 'PLAYER_JOINED': return `${playerName} joined the table`;
    case 'PEEK_ALERT': return `👁 ${playerName} peeked at a card — watch that pile`;
    case 'SEARCH_START': return payload.count ? `👁 ${playerName} is looking at the top ${payload.count} card${payload.count===1?'':'s'} of a pile` : `🔍 ${playerName} started searching a pile`;
    case 'REORDER_PIECE': return `${playerName} rearranged cards in a pile`;
    case 'SEARCH_END': return `${playerName} stopped searching`;
    case 'SET_TURN': {
      const activeId = payload.turnOrder[payload.turnIndex];
      const activeName = state.players.get(activeId) || 'someone';
      return `${playerName} passed the turn — now ${activeName}'s turn`;
    }
    case 'PING': { const where = (payload.tab && payload.tab!==state.currentTab) ? ` on the "${tabName(payload.tab)}" tab` : '';
      return payload.desc ? `📍 ${playerName} pinged ${payload.desc}${where}` : `${playerName} pinged the board${where}`; }
    case 'ROLL_DICE': return `${playerName} rolled a d${payload.sides} → ${payload.result}`;
    case 'CHAT': return `${payload.playerName}: "${payload.text}"`;
    case 'NOTE': return `${playerName} ${payload.text}`;
    default: return `${playerName} did something`;
  }
}

