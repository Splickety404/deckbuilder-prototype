/* =========================================================================
   HAND SCALE — user-adjustable hand card size, persisted per-browser.
   ========================================================================= */
const LS_HAND_SCALE_KEY = 'eoo_hand_scale';
const HAND_SCALE_MIN = 50, HAND_SCALE_MAX = 220;
const HAND_CARD_ASPECT = 1.4; // face height = width * this — matches .hand-card .face's CSS
function applyHandScale(px){
  px = Math.max(HAND_SCALE_MIN, Math.min(HAND_SCALE_MAX, Math.round(px)));
  state.handScale = px;
  document.documentElement.style.setProperty('--hand-card-width', px+'px');
  return px;
}
function initHandScale(){
  const stored = Number(localStorage.getItem(LS_HAND_SCALE_KEY));
  applyHandScale(stored>=HAND_SCALE_MIN && stored<=HAND_SCALE_MAX ? stored : 70);
}

// Dragging the seam between the board and the hand tray is the only way to resize
// your hand now (a separate size slider was redundant with this and got removed).
// Dragging UP (toward the board) grows the hand; dragging DOWN shrinks it. The
// vertical drag distance maps 1:1 onto the hand card's FACE height (not the panel's
// full height, which also includes fixed padding/label chrome), so the seam tracks
// the cursor exactly.
(function initHandResizeHandle(){
  const handle = document.getElementById('handResizeHandle');
  let drag = null;
  function start(clientY){
    drag = { startY: clientY, startFaceHeight: state.handScale * HAND_CARD_ASPECT };
    handle.classList.add('active');
  }
  function move(clientY){
    if(!drag) return;
    const dy = drag.startY - clientY; // up = positive = bigger hand
    const px = applyHandScale((drag.startFaceHeight + dy) / HAND_CARD_ASPECT);
    localStorage.setItem(LS_HAND_SCALE_KEY, String(px));
  }
  function end(){ drag = null; handle.classList.remove('active'); }
  handle.addEventListener('mousedown', (e)=>{ e.preventDefault(); start(e.clientY); });
  window.addEventListener('mousemove', (e)=>{ if(drag) move(e.clientY); });
  window.addEventListener('mouseup', ()=>{ if(drag) end(); });
  handle.addEventListener('touchstart', (e)=>{ start(e.touches[0].clientY); }, {passive:true});
  window.addEventListener('touchmove', (e)=>{ if(drag){ move(e.touches[0].clientY); } }, {passive:true});
  window.addEventListener('touchend', ()=>{ if(drag) end(); });
})();

/* =========================================================================
   TABLE THEME — board/hand background colors, shared table-wide (synced),
   since everyone at the table should see the same "felt".
   ========================================================================= */
function applyBoardTheme(theme){
  state.theme = theme;
  document.documentElement.style.setProperty('--board-bg', theme.boardColor || '#1a1c22');
  document.documentElement.style.setProperty('--hand-bg', theme.handColor || '#1c1f26');
}
// Anchors a toolbar dropdown (token menu, focus menu, theme popover) to the
// button that opened it, as a FIXED-position element measured and clamped to
// the viewport. These menus used to rely on being `position:absolute` with no
// explicit left/top and just sitting wherever their spot in the header's flex
// flow happened to land them — fine for a one-line list, but the token menu's
// "New type…" form is tall enough to land partly off-screen that way. Call
// this AFTER the menu's content is in place and it's been un-hidden (offset
// measurements are 0 while `display:none`).
// preferAbove: open upward (for controls near the bottom of the screen, like
// the chat tools), falling back to below only if there's no room above.
function positionMenuNear(menuEl, anchorEl, preferAbove){
  const rect = anchorEl.getBoundingClientRect();
  menuEl.style.position = 'fixed';
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = menuEl.offsetWidth || 200, mh = menuEl.offsetHeight || 100;
  let left = Math.min(rect.left, vw - mw - 8);
  let top = preferAbove && rect.top - mh - 4 >= 8 ? rect.top - mh - 4 : rect.bottom + 4;
  if(top + mh > vh) top = Math.max(8, rect.top - mh - 4); // not enough room below — flip above the button instead
  menuEl.style.left = Math.max(8, left) + 'px';
  menuEl.style.top = Math.max(8, top) + 'px';
}
function openThemePopover(){
  const el = document.getElementById('themePopover');
  const old = { ...state.theme };
  el.innerHTML = `
    <div class="popover-row"><label>Board color</label><input type="color" id="themeBoardColor" value="${old.boardColor}"></div>
    <div class="popover-row"><label>Hand tray color</label><input type="color" id="themeHandColor" value="${old.handColor}"></div>
  `;
  function current(){ return { boardColor: document.getElementById('themeBoardColor').value, handColor: document.getElementById('themeHandColor').value }; }
  document.getElementById('themeBoardColor').addEventListener('input', ()=> applyBoardTheme(current())); // live preview, local only
  document.getElementById('themeHandColor').addEventListener('input', ()=> applyBoardTheme(current()));
  document.getElementById('themeBoardColor').addEventListener('change', ()=> doAction('SET_THEME', current())); // commits + syncs
  document.getElementById('themeHandColor').addEventListener('change', ()=> doAction('SET_THEME', current()));
  el.classList.remove('hidden');
  positionMenuNear(el, document.getElementById('btnBoardMenu')); // btnTheme itself lives in the Board menu, which has just closed
}
document.getElementById('btnTheme').addEventListener('click', (e)=>{
  e.stopPropagation();
  document.getElementById('boardMenu').classList.add('hidden');
  const el = document.getElementById('themePopover');
  if(el.classList.contains('hidden')) openThemePopover(); else el.classList.add('hidden');
});
document.addEventListener('click', (e)=>{ if(!e.target.closest('#themePopover') && !e.target.closest('#btnTheme')) document.getElementById('themePopover').classList.add('hidden'); });
// "Board ▾" — table theme and saved-layout export/import, tucked into one menu.
document.getElementById('btnBoardMenu').addEventListener('click', (e)=>{
  e.stopPropagation();
  const menu = document.getElementById('boardMenu');
  const willShow = menu.classList.contains('hidden');
  document.getElementById('btnImportPrecon').style.display = state.gameFolderId ? '' : 'none'; // only for a table that knows its game
  menu.classList.toggle('hidden');
  if(willShow) positionMenuNear(menu, document.getElementById('btnBoardMenu'));
});
// Same list as the table's right-click Import Precon (which needs a spot of
// bare table to right-click — a board is mostly zones). The
// list opens by the menu; the deck lands in the middle of your view.
document.getElementById('btnImportPrecon').addEventListener('click', (e)=>{
  e.stopPropagation(); // the outside-click closers would shut the list as it opens
  document.getElementById('boardMenu').classList.add('hidden');
  const r = document.getElementById('btnBoardMenu').getBoundingClientRect();
  const vp = document.getElementById('boardViewport').getBoundingClientRect();
  openPreconMenuAt(r.left, r.bottom + 4, clientToWorld(vp.left + vp.width/2, vp.top + vp.height/2));
});
document.addEventListener('click', (e)=>{ if(!e.target.closest('#btnBoardMenu') && !e.target.closest('#btnTheme')) document.getElementById('boardMenu').classList.add('hidden'); });

/* =========================================================================
   DICE ROLLER — rolled locally, then broadcast (result only) to the whole
   table via ROLL_DICE; every client (including the roller) shows the same
   brief popup through applyRoomEvent, so there's nothing special about the
   local case — it's just the first "remote" apply, echoed instantly.
   ========================================================================= */
let diceResultTimer = null;
function showDiceResult(sides, result){
  const el = document.getElementById('diceResult');
  el.innerHTML = `<div class="dice-sides">d${sides}</div><div class="dice-value">${result}</div>`;
  el.classList.remove('hidden');
  clearTimeout(diceResultTimer);
  diceResultTimer = setTimeout(()=> el.classList.add('hidden'), 2600);
}
function rollDice(sides){
  sides = Math.max(2, Math.round(sides)||6);
  const result = 1 + Math.floor(Math.random()*sides);
  doAction('ROLL_DICE', {sides, result});
}
function openDicePopover(){
  const el = document.getElementById('dicePopover');
  el.innerHTML = `
    <div class="dice-presets">
      ${[4,6,8,10,12,20].map(s=>`<div class="dice-preset-btn" data-sides="${s}">d${s}</div>`).join('')}
    </div>
    <div class="popover-row"><label>Custom sides</label><input type="text" id="diceCustomSides" placeholder="e.g. 100" style="width:60px;flex:none;"></div>
    <div class="popover-actions"><div class="btn btn-accent btn-sm" id="btnRollDice" style="flex:1;justify-content:center;">Roll</div></div>
  `;
  [...el.querySelectorAll('.dice-preset-btn')].forEach(btn=>{
    btn.addEventListener('click', ()=>{ rollDice(Number(btn.dataset.sides)); el.classList.add('hidden'); });
  });
  document.getElementById('btnRollDice').addEventListener('click', ()=>{
    const custom = Number(document.getElementById('diceCustomSides').value);
    if(custom>1){ rollDice(custom); el.classList.add('hidden'); }
  });
  el.classList.remove('hidden');
  // Was relying on wherever #dicePopover happened to land in the toolbar's
  // own flex flow (position:absolute with no left/top ever set) — fine near
  // the left edge, but popped off the right/bottom of the screen for anyone
  // whose toolbar put the Dice button further along the row. positionMenuNear
  // (see its own comment, already used by the token/theme menus for the same
  // reason) clamps it to the actual viewport instead.
  positionMenuNear(el, document.getElementById('btnDice'), true);
}
document.getElementById('btnDice').addEventListener('click', (e)=>{
  e.stopPropagation();
  const el = document.getElementById('dicePopover');
  if(el.classList.contains('hidden')) openDicePopover(); else el.classList.add('hidden');
});
document.addEventListener('click', (e)=>{ if(!e.target.closest('#dicePopover') && !e.target.closest('#btnDice')) document.getElementById('dicePopover').classList.add('hidden'); });


