/* =========================================================================
   STATE
   ========================================================================= */
function randomId(len){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<(len||6);i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
const state = {
  clientId: randomId(10),
  sessionCode: '',
  playerId: randomId(8),
  playerName: '',       // set from the signed-in Google account's name at sign-in, not user-typed
  idToken: '',          // signed-in Google ID token, sent with every card-data fetch for the access check
  userEmail: '',
  hasInitialState: false, // true once this client has real board state — either it's the host, or a REQUEST_STATE/STATE_SNAPSHOT round-trip completed (or timed out)
  pieces: new Map(),   // id -> { id, x, y, cardIds:[...], faceStates:[bool,...], owner, splayed, splayDir, splaySpacing, label }
  tokens: new Map(),   // id -> { id, x, y, type, count, attachedTo: pieceId|null, attachedCardIndex: number|null }
  tokenTypes: new Map(), // name -> color (hex) — shared table-wide, user-defined; no built-in types
  tokenTypeStyles: new Map(), // name -> {symbol, image, shape} — the rest of a type's look (see tokenFaceMarkup)
  deckRecords: new Map(), // id -> {id, name, owner, order:[cardIds, top card first], pieceId} — every imported deck, for Reform Deck
  gameFolderId: '', // the game this table's board came from (board link / Send deck to room) — shared with the table; enables Import Precon
  zones: new Map(),    // id -> { id, x, y, w, h, color, strokeColor, strokeWidth, label, snapMode }
  theme: { boardColor:'#1a1c22', handColor:'#1c1f26' }, // shared table theme, synced
  hand: [],            // array of cardIds — private, never synced except as a count
  handTokens: new Map(), // token type -> how many of it are in this player's hand; the counts are public (see syncHandCount)
  handFaceDown: [],    // parallel to hand: true = that hand card is flipped face down (see syncHandFaceDown) — private, never synced
  playerHandCounts: new Map(), // playerId -> {playerName, count} — public, synced
  view: { x:0, y:0, scale:0.6 }, // board-world panning/zoom, local per-viewer, never synced
  viewRotation: 0,      // 0/90/180/270 — local per-viewer, never synced
  handScale: 70,         // px, local per-viewer, persisted in localStorage
  undoFn: null,          // single-level undo for the local player's last action
  snapToGrid: false,    // local per-viewer, never synced
  tabs: [{id:'main', name:'Table'}], // the board's tabs — shared; each piece/token/zone has a .tab (default 'main')
  currentTab: 'main',   // which tab THIS viewer is looking at — local, never synced
  editingZoneId: null,  // local per-viewer, never synced — the one zone (if any) currently open for editing via right-click; only it can be moved/resized
  peekAlertIds: new Set(), // pieceIds with a brief "someone just peeked here" highlight — self-clears after PEEK_ALERT_MS
  searchingBy: new Map(), // pieceId -> playerName currently rifling through it — cleared on SEARCH_END
  players: new Map(),   // playerId -> playerName — everyone who has ever joined, synced via PLAYER_JOINED
  turnOrder: [],         // array of playerIds — synced via SET_TURN, built lazily from state.players
  turnIndex: -1,          // index into turnOrder of whoever's turn it is; -1 = not started
  selectedIds: new Set(), // piece ids currently multi-selected — local per-viewer, never synced
  selectedTokenIds: new Set(), // token ids currently multi-selected — mirrors selectedIds, local per-viewer, never synced
  showGrid: false,       // local per-viewer, persisted in localStorage
  gridSize: 80,          // px (world-space), local per-viewer, persisted in localStorage
};
function newPieceId(){ return state.playerId + '-' + randomId(8); }
function newTokenId(){ return state.playerId + '-tok-' + randomId(8); }
function newZoneId(){ return state.playerId + '-zone-' + randomId(8); }
function hexToRgba(hex, alpha){
  const h = (hex||'#546178').replace('#','');
  const full = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
  const r = parseInt(full.slice(0,2),16)||0, g = parseInt(full.slice(2,4),16)||0, b = parseInt(full.slice(4,6),16)||0;
  return `rgba(${r},${g},${b},${alpha})`;
}

